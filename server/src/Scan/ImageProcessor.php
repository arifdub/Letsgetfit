<?php

declare(strict_types=1);

namespace LetsGetFit\Scan;

/**
 * Checks an uploaded meal photo and re-encodes it as a fresh JPEG with GD. Re-encoding drops
 * all metadata (EXIF, GPS location, camera details, comments), limits the size sent to the AI
 * provider, and defeats files that only pretend to be images. Nothing is written to disk.
 */
final class ImageProcessor
{
    public const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
    public const MIN_SIDE = 64;
    public const MAX_SIDE_IN = 10000;
    public const MAX_PIXELS_IN = 40_000_000; // guards against decompression bombs
    public const MAX_SIDE_OUT = 1280;
    public const JPEG_QUALITY = 82;

    public function __construct(private int $maxBytes)
    {
    }

    public static function available(): bool
    {
        return function_exists('imagecreatefromstring') && function_exists('imagejpeg');
    }

    /**
     * @return array{jpeg: string, width: int, height: int}
     * @throws ScanException
     */
    public function process(string $bytes): array
    {
        if (!self::available()) {
            throw new ScanException('image_processing_unavailable', 'Photo scanning is not available on this server.', 503);
        }
        $size = strlen($bytes);
        if ($size === 0) {
            throw new ScanException('no_image', 'Choose a photo to scan.', 400);
        }
        if ($size > $this->maxBytes) {
            throw new ScanException('too_large', 'That photo is too large. Use one under ' . round($this->maxBytes / 1_000_000) . ' MB.', 413);
        }
        $type = (new \finfo(FILEINFO_MIME_TYPE))->buffer($bytes);
        if (!in_array($type, self::ALLOWED_TYPES, true)) {
            throw new ScanException('unsupported_type', 'Use a JPEG, PNG or WebP photo.', 415);
        }
        $info = @getimagesizefromstring($bytes);
        if ($info === false || $info[0] < self::MIN_SIDE || $info[1] < self::MIN_SIDE) {
            throw new ScanException('bad_image', 'That photo could not be read, or it is too small.', 422);
        }
        if ($info[0] > self::MAX_SIDE_IN || $info[1] > self::MAX_SIDE_IN || $info[0] * $info[1] > self::MAX_PIXELS_IN) {
            throw new ScanException('too_large', 'That photo has too many pixels. Use a smaller one.', 413);
        }
        $src = @imagecreatefromstring($bytes);
        if ($src === false) {
            throw new ScanException('bad_image', 'That photo could not be read.', 422);
        }
        try {
            $src = self::applyOrientation($src, $bytes, $type);
            $w = imagesx($src);
            $h = imagesy($src);
            $scale = min(1, self::MAX_SIDE_OUT / max($w, $h));
            $nw = max(1, (int) round($w * $scale));
            $nh = max(1, (int) round($h * $scale));
            $dst = imagecreatetruecolor($nw, $nh);
            // White background for transparent PNG/WebP.
            imagefill($dst, 0, 0, imagecolorallocate($dst, 255, 255, 255));
            imagecopyresampled($dst, $src, 0, 0, 0, 0, $nw, $nh, $w, $h);
            ob_start();
            imagejpeg($dst, null, self::JPEG_QUALITY);
            $jpeg = (string) ob_get_clean();
            imagedestroy($dst);
        } finally {
            imagedestroy($src);
        }

        return ['jpeg' => $jpeg, 'width' => $nw, 'height' => $nh];
    }

    /** Rotate according to EXIF orientation (before the metadata is discarded). */
    private static function applyOrientation(\GdImage $img, string $bytes, string $type): \GdImage
    {
        if ($type !== 'image/jpeg' || !function_exists('exif_read_data')) {
            return $img;
        }
        $exif = @exif_read_data('data://image/jpeg;base64,' . base64_encode($bytes));
        $angle = match ((int) ($exif['Orientation'] ?? 1)) {
            3 => 180,
            6 => -90,
            8 => 90,
            default => 0,
        };
        if ($angle === 0) {
            return $img;
        }
        $rotated = imagerotate($img, $angle, 0);
        if ($rotated === false) {
            return $img;
        }
        imagedestroy($img);

        return $rotated;
    }
}

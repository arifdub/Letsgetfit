<?php

declare(strict_types=1);

namespace LetsGetFit\Scan;

/** A scan could not be completed. The code and message are safe to show to the user. */
final class ScanException extends \RuntimeException
{
    public function __construct(public readonly string $reason, string $message, public readonly int $status = 502)
    {
        parent::__construct($message);
    }
}

<?php

declare(strict_types=1);

namespace LetsGetFit\Mail;

/**
 * Development and test transport: writes each email as a JSON file in the private storage
 * folder (outside the web root) instead of sending it. Never use in production.
 */
final class OutboxMailer implements Mailer
{
    public function __construct(private string $dir)
    {
    }

    public function send(string $to, string $subject, string $text): void
    {
        if (!is_dir($this->dir) && !@mkdir($this->dir, 0700, true)) {
            throw new \RuntimeException('Outbox not writable.');
        }
        $file = sprintf('%s/%s-%s.json', $this->dir, gmdate('Ymd\THis'), bin2hex(random_bytes(4)));
        file_put_contents($file, json_encode(['to' => $to, 'subject' => $subject, 'text' => $text], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    }
}

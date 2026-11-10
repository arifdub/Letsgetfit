<?php

declare(strict_types=1);

namespace LetsGetFit\Mail;

use LetsGetFit\Config;
use PHPMailer\PHPMailer\PHPMailer;

/** SMTP delivery through PHPMailer (maintained library), with TLS and short timeouts. */
final class SmtpMailer implements Mailer
{
    public function __construct(private Config $config)
    {
    }

    public function send(string $to, string $subject, string $text): void
    {
        if (!class_exists(PHPMailer::class)) {
            throw new \RuntimeException('PHPMailer is not installed (server/vendor missing).');
        }
        $mail = new PHPMailer(true);
        $mail->isSMTP();
        $mail->Host = $this->config->string('smtp_host');
        $mail->Port = $this->config->int('smtp_port') ?: 587;
        $mail->SMTPAuth = $this->config->string('smtp_user') !== '';
        $mail->Username = $this->config->string('smtp_user');
        $mail->Password = $this->config->string('smtp_password');
        $mail->SMTPSecure = $this->config->string('smtp_secure') === 'ssl' ? PHPMailer::ENCRYPTION_SMTPS : PHPMailer::ENCRYPTION_STARTTLS;
        $mail->Timeout = 10;
        $mail->CharSet = PHPMailer::CHARSET_UTF8;
        $mail->setFrom($this->config->string('mail_from'), $this->config->string('mail_from_name'));
        $mail->addAddress($to);
        $mail->Subject = $subject;
        $mail->Body = $text;
        $mail->isHTML(false);
        try {
            $mail->send();
            $this->record('ok');
        } catch (\Throwable $e) {
            $category = self::category($mail->ErrorInfo . ' ' . $e->getMessage());
            $this->record($category);
            // Never include the recipient or message in the error.
            throw new \RuntimeException('SMTP delivery failed: ' . $category, 0, $e);
        }
    }

    /** A short reason with no personal data: connect, tls, auth, sender, recipient or other. */
    public static function category(string $error): string
    {
        $e = strtolower($error);

        return match (true) {
            str_contains($e, 'authenticate') || str_contains($e, 'auth') && str_contains($e, 'fail') => 'auth',
            str_contains($e, 'certificate') || str_contains($e, 'ssl') || str_contains($e, 'tls') || str_contains($e, 'crypto') => 'tls',
            str_contains($e, 'connect') || str_contains($e, 'timed out') || str_contains($e, 'refused') => 'connect',
            str_contains($e, 'from address') || str_contains($e, 'sender') || str_contains($e, 'mail from') => 'sender',
            str_contains($e, 'recipient') => 'recipient',
            default => 'other',
        };
    }

    /** The result of the last send, for the health check (no addresses or messages). */
    private function record(string $status): void
    {
        $dir = $this->config->string('storage_dir');
        if ($dir === '') {
            return;
        }
        @file_put_contents($dir . '/mail-status.json', json_encode(['status' => $status, 'at' => gmdate('Y-m-d\TH:i:s\Z')]), LOCK_EX);
    }

    /** @return array{status: string, at: string}|null */
    public static function lastStatus(string $storageDir): ?array
    {
        $raw = @file_get_contents($storageDir . '/mail-status.json');
        $data = is_string($raw) ? json_decode($raw, true) : null;

        return is_array($data) && is_string($data['status'] ?? null) && is_string($data['at'] ?? null) ? ['status' => $data['status'], 'at' => $data['at']] : null;
    }
}

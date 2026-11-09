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
        } catch (\Throwable $e) {
            // Never include the recipient or message in the error.
            throw new \RuntimeException('SMTP delivery failed.', 0, $e);
        }
    }
}

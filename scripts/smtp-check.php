<?php

declare(strict_types=1);

// Checks the SMTP secrets from the deploy workflow: connects and logs in, but sends nothing.
// If the configured port and security fail, it also tries the other common combination
// (465 + ssl, 587 + tls) and says which works. Never prints the password or the username.
// Usage: SMTP_HOST=… SMTP_USER=… SMTP_PASSWORD=… MAIL_FROM=… php scripts/smtp-check.php

require __DIR__ . '/../server/bootstrap.php';

use LetsGetFit\Mail\SmtpMailer;
use PHPMailer\PHPMailer\PHPMailer;

$env = static fn (string $n, string $d = ''): string => is_string(getenv($n)) && getenv($n) !== '' ? (string) getenv($n) : $d;
$host = $env('SMTP_HOST');
$password = $env('SMTP_PASSWORD');
$user = $env('SMTP_USER', $env('MAIL_FROM'));
if ($host === '' || $password === '' || $user === '') {
    echo "smtp-check: SMTP_HOST, SMTP_PASSWORD and SMTP_USER (or MAIL_FROM) are needed.\n";
    exit(1);
}
$secure = $env('SMTP_SECURE', 'tls') === 'ssl' ? 'ssl' : 'tls';
$port = (int) $env('SMTP_PORT', $secure === 'ssl' ? '465' : '587');

$scrub = static fn (string $s): string => trim(str_replace([$password, $user], ['[password]', '[username]'], preg_replace('/\s+/', ' ', $s) ?? ''));

$try = static function (int $port, string $secure) use ($host, $user, $password, $scrub): array {
    $mail = new PHPMailer(true);
    $mail->isSMTP();
    $mail->Host = $host;
    $mail->Port = $port;
    $mail->SMTPAuth = true;
    $mail->Username = $user;
    $mail->Password = $password;
    $mail->SMTPSecure = $secure === 'ssl' ? PHPMailer::ENCRYPTION_SMTPS : PHPMailer::ENCRYPTION_STARTTLS;
    $mail->Timeout = 10;
    $debug = '';
    $mail->SMTPDebug = 1;
    $mail->Debugoutput = static function (string $line) use (&$debug): void {
        $debug .= $line . ' ';
    };
    try {
        $ok = $mail->smtpConnect();
        $mail->smtpClose();

        return [$ok, $ok ? '' : $scrub($mail->ErrorInfo . ' ' . $debug)];
    } catch (\Throwable $e) {
        return [false, $scrub($mail->ErrorInfo . ' ' . $e->getMessage() . ' ' . $debug)];
    }
};

[$ok, $error] = $try($port, $secure);
if ($ok) {
    echo "smtp-check: OK. Logged in to the mail server on port $port ($secure). Email settings work.\n";
    exit(0);
}
$reason = SmtpMailer::category($error);
$hints = [
    'auth' => 'The mail server refused the username or password. Check SMTP_PASSWORD (the mailbox password) and that SMTP_USER or MAIL_FROM is the full mailbox address.',
    'tls' => 'A secure connection could not be set up. Try the other port and security (see below), or check SMTP_HOST matches the name on the mail server certificate.',
    'connect' => 'Could not reach the mail server. Check SMTP_HOST, SMTP_PORT and SMTP_SECURE.',
];
echo "smtp-check: FAILED on port $port ($secure): $reason. " . ($hints[$reason] ?? '') . "\n";
echo 'smtp-check: detail: ' . substr($error, 0, 400) . "\n";
[$altPort, $altSecure] = $secure === 'ssl' ? [587, 'tls'] : [465, 'ssl'];
[$altOk, $altError] = $try($altPort, $altSecure);
echo $altOk
    ? "smtp-check: port $altPort ($altSecure) WORKS. Set the secrets SMTP_PORT=$altPort and SMTP_SECURE=$altSecure, then deploy again.\n"
    : "smtp-check: port $altPort ($altSecure) also failed: " . SmtpMailer::category($altError) . ".\n";
exit(1);

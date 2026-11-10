<?php

declare(strict_types=1);

namespace LetsGetFit\Push;

use LetsGetFit\Accounts\AccountController;
use LetsGetFit\Auth\SessionManager;
use LetsGetFit\Config;
use LetsGetFit\RateLimiter;
use PDO;

/**
 * /api/push.php?action=...
 *
 * GET  key                       the public VAPID key the browser needs to subscribe
 * POST subscribe {subscription, timezone, reminders}   turn on (or update) this device
 * POST unsubscribe {endpoint}    turn off this device
 * POST status {endpoint}         this device's saved reminders
 * POST test {endpoint}           send a test notification to this device
 * POST cron                      send due reminders (header X-Cron-Token; for the scheduler)
 *
 * No account is needed: anyone can get reminders on their own device. If they are logged in, the
 * subscription is linked to the account so it is removed with it. The push address works like a
 * password for that device, so it is never shown back or logged.
 */
final class PushController
{
    public function __construct(
        private PDO $pdo,
        private PushService $push,
        private SessionManager $session,
        private RateLimiter $limiter,
        private Config $config,
    ) {
    }

    /** @return array{0: int, 1: array<string, mixed>, 2: array<string, string>} */
    public function handle(array $server, array $query, string $rawBody): array
    {
        $method = (string) ($server['REQUEST_METHOD'] ?? 'GET');
        $action = is_string($query['action'] ?? null) ? $query['action'] : '';
        $ip = (string) ($server['REMOTE_ADDR'] ?? '');

        if ($method === 'GET' && $action === 'key') {
            return [200, ['enabled' => true, 'publicKey' => $this->push->keys()['publicKey'], 'types' => array_keys(Reminders::TYPES)], ['Cache-Control' => 'no-store']];
        }
        if ($method !== 'POST') {
            return AccountController::error(405, 'method_not_allowed', 'Use POST.');
        }
        if ($action === 'cron') {
            return $this->cron($server);
        }
        if (!AccountController::sameOrigin($server, $this->config)) {
            return AccountController::error(403, 'bad_origin', 'This request did not come from LetsGetFit.');
        }
        if (!str_starts_with(strtolower((string) ($server['CONTENT_TYPE'] ?? '')), 'application/json')) {
            return AccountController::error(415, 'json_required', 'Send JSON.');
        }
        $body = strlen($rawBody) <= 8000 ? json_decode($rawBody, true) : null;
        if (!is_array($body)) {
            return AccountController::error(400, 'bad_json', 'The request could not be read.');
        }
        if ($wait = $this->limiter->hitVisitor("push:ip:$ip", 60, 3600)) {
            return AccountController::rateLimited($wait);
        }

        return match ($action) {
            'subscribe' => $this->subscribe($body),
            'unsubscribe' => $this->unsubscribe($body),
            'status' => $this->status($body),
            'test' => $this->test($body),
            default => AccountController::error(404, 'unknown_action', 'Unknown action.'),
        };
    }

    private function subscribe(array $body): array
    {
        [$reminders, $error] = Reminders::validate($body['reminders'] ?? []);
        if ($error !== null) {
            return AccountController::error(422, 'bad_reminders', $error, [], 'reminders');
        }
        $userId = null;
        // Link to the account only if this browser already has a session: no new cookie is set
        // for people who are not logged in.
        $cookie = $this->config->string('cookie_name') ?: '__Host-lgf_session';
        if (isset($_COOKIE[$cookie])) {
            try {
                $this->session->start();
                $userId = $this->session->userId($this->pdo);
            } catch (\Throwable) {
                $userId = null; // notifications work without an account
            }
        }
        $sub = is_array($body['subscription'] ?? null) ? $body['subscription'] : [];
        if ($error = $this->push->save($sub, Reminders::validTimezone($body['timezone'] ?? null), $reminders, $userId)) {
            return AccountController::error(422, 'bad_subscription', $error);
        }

        return [200, ['ok' => true, 'reminders' => $reminders, 'message' => $reminders === []
            ? 'Notifications are on for this device. You will get announcements from LetsGetFit.'
            : 'Saved. Reminders will arrive on this device at the times you chose.'], ['Cache-Control' => 'no-store']];
    }

    private function unsubscribe(array $body): array
    {
        $endpoint = is_string($body['endpoint'] ?? null) ? $body['endpoint'] : '';
        if ($endpoint !== '') {
            $this->push->delete($endpoint);
        }

        return [200, ['ok' => true, 'message' => 'Notifications are off for this device.'], ['Cache-Control' => 'no-store']];
    }

    private function status(array $body): array
    {
        $row = is_string($body['endpoint'] ?? null) ? $this->push->find($body['endpoint']) : null;
        if ($row === null) {
            return [200, ['subscribed' => false], ['Cache-Control' => 'no-store']];
        }
        [$reminders] = Reminders::validate(json_decode((string) $row['reminders'], true));

        return [200, ['subscribed' => true, 'reminders' => $reminders, 'timezone' => $row['timezone']], ['Cache-Control' => 'no-store']];
    }

    private function test(array $body): array
    {
        $endpoint = is_string($body['endpoint'] ?? null) ? $body['endpoint'] : '';
        $row = $endpoint !== '' ? $this->push->find($endpoint) : null;
        if ($row === null) {
            return AccountController::error(404, 'not_subscribed', 'Notifications are not on for this device yet.');
        }
        if ($wait = $this->limiter->hitVisitor('push:test:' . hash('sha256', $endpoint), 5, 3600)) {
            return AccountController::rateLimited($wait);
        }
        $result = $this->push->send([$row], ['title' => 'LetsGetFit', 'body' => 'Notifications are working on this device.', 'url' => './#settings', 'tag' => 'test']);

        return $result['sent'] === 1
            ? [200, ['ok' => true, 'message' => 'Test notification sent. It should appear in a few seconds.'], ['Cache-Control' => 'no-store']]
            : AccountController::error(502, 'push_failed', 'The notification could not be delivered. Turn notifications off and on again on this device.');
    }

    private function cron(array $server): array
    {
        $expected = self::cronToken($this->config);
        $given = (string) ($server['HTTP_X_CRON_TOKEN'] ?? '');
        if ($expected === '' || !hash_equals($expected, $given)) {
            return AccountController::error(403, 'bad_token', 'Not allowed.');
        }

        return [200, ['ok' => true] + $this->push->sendDueReminders(time()), ['Cache-Control' => 'no-store']];
    }

    /** The scheduler's token: derived from the app secret, so nothing extra needs storing. */
    public static function cronToken(Config $config): string
    {
        $secret = $config->string('hash_secret');

        return strlen($secret) >= 16 ? hash_hmac('sha256', 'letsgetfit-cron', $secret) : '';
    }
}

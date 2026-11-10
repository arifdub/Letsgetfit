<?php

declare(strict_types=1);

namespace LetsGetFit\Scan;

use Anthropic\Client;
use Anthropic\Core\Exceptions\APIConnectionException;
use Anthropic\Core\Exceptions\APIException;
use Anthropic\Core\Exceptions\APITimeoutException;
use Anthropic\Core\Exceptions\AuthenticationException;
use Anthropic\Core\Exceptions\BadRequestException;
use Anthropic\Core\Exceptions\InternalServerException;
use Anthropic\Core\Exceptions\PermissionDeniedException;
use Anthropic\Core\Exceptions\RateLimitException;
use GuzzleHttp\Client as Guzzle;
use LetsGetFit\Config;

/**
 * Claude (Anthropic) vision adapter, through the official Anthropic PHP SDK. Same job, prompt and
 * JSON shape as the OpenAI adapter, so the two can be swapped or compared: the model only suggests
 * foods, portion ranges and questions, never nutrients.
 *
 * Structured outputs (output_config.format) guarantee JSON matching the schema. Thinking is
 * adaptive, with its depth set by the effort setting. Server-side fallbacks ("default") are on, so
 * a request the chosen model declines can be retried on another model by Anthropic.
 */
final class ClaudeVision implements VisionProvider
{
    /** US$ per million tokens (input, output), list prices for the built-in cost estimate. */
    public const PRICES = [
        'claude-opus-5-5' => [4.00, 20.00],
        'claude-opus-5' => [5.00, 25.00],
        'claude-sonnet-5-5' => [2.00, 10.00],
        'claude-sonnet-5' => [2.00, 10.00],
        'claude-haiku-5-5' => [0.10, 0.50],
        'claude-haiku-4-5' => [1.00, 5.00],
    ];

    private ?Client $client;

    public function __construct(private Config $config, ?Client $client = null)
    {
        $this->client = $client;
    }

    public function key(): string
    {
        return 'claude';
    }

    public function label(): string
    {
        return 'Claude (Anthropic)';
    }

    public function model(): string
    {
        return $this->config->string('anthropic_model') ?: 'claude-opus-5-5';
    }

    public function configured(): bool
    {
        return trim($this->config->string('anthropic_api_key')) !== '' && class_exists(Client::class);
    }

    public function analyse(string $jpeg): array
    {
        return $this->request(OpenAiVision::SYSTEM_PROMPT, [
            ['type' => 'image', 'source' => ['type' => 'base64', 'mediaType' => 'image/jpeg', 'data' => base64_encode($jpeg)]],
            ['type' => 'text', 'text' => 'Identify the foods in this meal photo.'],
        ]);
    }

    public function analyseText(string $text): array
    {
        return $this->request(OpenAiVision::TEXT_PROMPT, [
            ['type' => 'text', 'text' => "What I ate:\n" . $text],
        ]);
    }

    /** @param list<array<string, mixed>> $content */
    private function request(string $system, array $content): array
    {
        if (!$this->configured()) {
            throw new ScanException('not_configured', 'Photo scanning is not set up on this server yet. Add the food manually.', 503);
        }
        $effort = in_array($this->config->string('anthropic_effort'), ['low', 'medium', 'high'], true) ? $this->config->string('anthropic_effort') : 'medium';

        try {
            $message = $this->client()->beta->messages->create(
                model: $this->model(),
                maxTokens: max(1024, $this->config->int('anthropic_max_tokens')),
                system: $system,
                messages: [['role' => 'user', 'content' => $content]],
                thinking: ['type' => 'adaptive'],
                outputConfig: [
                    'effort' => $effort,
                    'format' => ['type' => 'json_schema', 'schema' => OpenAiVision::schema()],
                ],
                fallbacks: 'default',
                betas: ['server-side-fallback-2026-07-01'],
            );
        } catch (AuthenticationException | PermissionDeniedException) {
            throw new ScanException('not_configured', 'Photo scanning is not set up correctly on this server. Add the food manually.', 503);
        } catch (RateLimitException) {
            throw new ScanException('provider_busy', 'Photo analysis is busy right now. Try again later, or add the food manually.', 503);
        } catch (BadRequestException) {
            throw new ScanException('bad_image', 'That photo could not be analysed. Try another one, or add the food manually.', 422);
        } catch (APITimeoutException) {
            throw new ScanException('timeout', 'The photo took too long to analyse. Try again, or add the food manually.', 504);
        } catch (APIConnectionException $e) {
            $timedOut = str_contains(strtolower($e->getMessage() . ' ' . ($e->getPrevious()?->getMessage() ?? '')), 'timed out');
            throw $timedOut
                ? new ScanException('timeout', 'The photo took too long to analyse. Try again, or add the food manually.', 504)
                : new ScanException('provider_unavailable', 'Photo analysis is not available right now. Add the food manually.', 502);
        } catch (InternalServerException | APIException) {
            throw new ScanException('provider_unavailable', 'Photo analysis is not available right now. Add the food manually.', 502);
        }

        $stop = (string) ($message->stopReason ?? '');
        if ($stop === 'refusal') {
            throw new ScanException('refused', 'This photo could not be analysed. Try a clear photo of the food, or add it manually.', 422);
        }
        if ($stop === 'max_tokens') {
            throw new ScanException('incomplete', 'The analysis was cut short. Try a photo with fewer foods, or add them manually.', 502);
        }
        $parsed = null;
        foreach ($message->content as $block) {
            if (($block->type ?? '') === 'text') {
                $parsed = json_decode((string) $block->text, true);
                break;
            }
        }
        if (!is_array($parsed)) {
            throw new ScanException('provider_unavailable', 'Photo analysis gave an unexpected reply. Add the food manually.', 502);
        }

        return OpenAiVision::sanitise($parsed) + ['usage' => [
            'input' => (int) ($message->usage->inputTokens ?? 0),
            'output' => (int) ($message->usage->outputTokens ?? 0),
        ]];
    }

    /** [input, output] US$ per million tokens: the admin's override, else the built-in list price. */
    public static function prices(Config $config, string $model): array
    {
        $in = $config->float('claude_price_input');
        $out = $config->float('claude_price_output');
        if ($in > 0 || $out > 0) {
            return [$in, $out];
        }

        return self::PRICES[$model] ?? [0.0, 0.0];
    }

    private function client(): Client
    {
        return $this->client ??= new Client(
            apiKey: trim($this->config->string('anthropic_api_key')),
            baseUrl: rtrim($this->config->string('anthropic_base_url'), '/') ?: 'https://api.anthropic.com',
            requestOptions: [
                'maxRetries' => 1,
                // The SDK leaves timeouts to the HTTP client, so they are set here.
                'transporter' => new Guzzle([
                    'connect_timeout' => 5,
                    'timeout' => max(10, $this->config->int('anthropic_timeout_seconds')),
                ]),
            ],
        );
    }
}

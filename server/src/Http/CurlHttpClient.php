<?php

declare(strict_types=1);

namespace LetsGetFit\Http;

/** Outbound HTTPS with strict timeouts, TLS verification and a response size cap. */
final class CurlHttpClient implements HttpClient
{
    private const MAX_BYTES = 2_000_000;

    public function get(string $url, array $headers, int $connectTimeout, int $timeout): HttpResponse
    {
        return $this->request('GET', $url, $headers, null, $connectTimeout, $timeout);
    }

    public function post(string $url, array $headers, string $body, int $connectTimeout, int $timeout): HttpResponse
    {
        return $this->request('POST', $url, $headers, $body, $connectTimeout, $timeout);
    }

    /** @param array<string, string> $headers */
    private function request(string $method, string $url, array $headers, ?string $payload, int $connectTimeout, int $timeout): HttpResponse
    {
        if (!function_exists('curl_init')) {
            throw new HttpException(HttpException::NETWORK, 'The PHP cURL extension is not enabled.');
        }
        $body = '';
        $tooLarge = false;
        $ch = curl_init($url);
        $headerLines = ['Accept: application/json', 'User-Agent: LetsGetFit/0.2 (+https://letsgetfit.site)'];
        foreach ($headers as $name => $value) {
            $headerLines[] = $name . ': ' . $value;
        }
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => $headerLines,
            CURLOPT_CONNECTTIMEOUT => $connectTimeout,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS | CURLPROTO_HTTP,
            CURLOPT_ENCODING => '',
            CURLOPT_WRITEFUNCTION => static function ($ch, string $chunk) use (&$body, &$tooLarge): int {
                if (strlen($body) + strlen($chunk) > self::MAX_BYTES) {
                    $tooLarge = true;

                    return 0; // abort
                }
                $body .= $chunk;

                return strlen($chunk);
            },
        ]);
        if ($payload !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
        }
        $ok = curl_exec($ch);
        $errno = curl_errno($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);

        if ($tooLarge) {
            throw new HttpException(HttpException::NETWORK, 'Response too large.');
        }
        if ($ok === false || $errno !== 0) {
            $kind = $errno === CURLE_OPERATION_TIMEDOUT ? HttpException::TIMEOUT : HttpException::NETWORK;
            throw new HttpException($kind, 'cURL error ' . $errno);
        }

        return new HttpResponse($status, $body);
    }
}

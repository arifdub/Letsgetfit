<?php

declare(strict_types=1);

namespace LetsGetFit\Http;

interface HttpClient
{
    /**
     * @param array<string, string> $headers
     * @throws HttpException on timeout or network failure
     */
    public function get(string $url, array $headers, int $connectTimeout, int $timeout): HttpResponse;

    /**
     * @param array<string, string> $headers
     * @throws HttpException on timeout or network failure
     */
    public function post(string $url, array $headers, string $body, int $connectTimeout, int $timeout): HttpResponse;
}

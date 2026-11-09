<?php

declare(strict_types=1);

namespace LetsGetFit\Http;

final class HttpException extends \RuntimeException
{
    public const TIMEOUT = 'timeout';
    public const NETWORK = 'network';

    public function __construct(public readonly string $kind, string $message = '')
    {
        parent::__construct($message !== '' ? $message : $kind);
    }
}

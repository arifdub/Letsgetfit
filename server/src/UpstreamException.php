<?php

declare(strict_types=1);

namespace LetsGetFit;

/** A food data provider could not answer. The code is safe to show to the browser. */
final class UpstreamException extends \RuntimeException
{
    public const TIMEOUT = 'timeout';
    public const BUSY = 'upstream_busy';
    public const UNAVAILABLE = 'upstream_unavailable';
    public const NOT_CONFIGURED = 'not_configured';

    public function __construct(public readonly string $reason)
    {
        parent::__construct($reason);
    }
}

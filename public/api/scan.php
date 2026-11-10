<?php

declare(strict_types=1);

// AI meal scan: POST multipart "photo" with X-Scan-Consent: yes and X-Request-Id.
// Off unless an OpenAI API key is set in the private settings.
require __DIR__ . '/bootstrap.inc.php';
\LetsGetFit\Api::run('scan', $letsgetfitPrivate);

<?php

declare(strict_types=1);

// Food search: GET /api/foods.php?q=apple&type=all|generic|branded
require __DIR__ . '/bootstrap.inc.php';
\LetsGetFit\Api::run('foods', $letsgetfitPrivate);

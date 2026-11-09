<?php

declare(strict_types=1);

namespace LetsGetFit\Mail;

interface Mailer
{
    /** @throws \RuntimeException when the message could not be handed to the mail system */
    public function send(string $to, string $subject, string $text): void;
}

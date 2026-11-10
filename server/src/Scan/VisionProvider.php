<?php

declare(strict_types=1);

namespace LetsGetFit\Scan;

/**
 * An AI service that suggests the foods and amounts in a meal photo. It never supplies nutrients:
 * those always come from the food database for the foods and grams the user confirms.
 */
interface VisionProvider
{
    /** Stable key used in settings and statistics: "openai" or "claude". */
    public function key(): string;

    /** Name shown to the user, e.g. "OpenAI" or "Claude (Anthropic)". */
    public function label(): string;

    public function model(): string;

    public function configured(): bool;

    /**
     * @return array{isFood: bool, imageQuality: string, items: list<array<string, mixed>>, questions: list<string>, usage: array{input: int, output: int}}
     * @throws ScanException
     */
    public function analyse(string $jpeg): array;
}

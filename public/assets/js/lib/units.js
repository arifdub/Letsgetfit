// Unit conversions. All stored values are canonical metric units:
// height in centimetres (cm), body weight in kilograms (kg), energy in kilocalories (kcal).
// Imperial input is converted once, at the point of entry, and only metric is stored.

export const CM_PER_INCH = 2.54; // exact, by international definition (1959)
export const KG_PER_POUND = 0.45359237; // exact, by international definition (1959)
export const POUNDS_PER_STONE = 14;
export const INCHES_PER_FOOT = 12;
export const KJ_PER_KCAL = 4.184; // thermochemical calorie, as used in EU Regulation 1169/2011

/** Round to a fixed number of decimal places without binary floating-point drift. */
export function roundTo(value, places = 1) {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function feetInchesToCm(feet, inches = 0) {
  return (feet * INCHES_PER_FOOT + inches) * CM_PER_INCH;
}

export function cmToFeetInches(cm) {
  const totalInches = cm / CM_PER_INCH;
  let feet = Math.floor(totalInches / INCHES_PER_FOOT);
  let inches = roundTo(totalInches - feet * INCHES_PER_FOOT, 0);
  if (inches === INCHES_PER_FOOT) {
    feet += 1;
    inches = 0;
  }
  return { feet, inches };
}

export function stonePoundsToKg(stone, pounds = 0) {
  return (stone * POUNDS_PER_STONE + pounds) * KG_PER_POUND;
}

export function kgToStonePounds(kg) {
  const totalPounds = kg / KG_PER_POUND;
  let stone = Math.floor(totalPounds / POUNDS_PER_STONE);
  let pounds = roundTo(totalPounds - stone * POUNDS_PER_STONE, 0);
  if (pounds === POUNDS_PER_STONE) {
    stone += 1;
    pounds = 0;
  }
  return { stone, pounds };
}

export function kcalToKj(kcal) {
  return kcal * KJ_PER_KCAL;
}

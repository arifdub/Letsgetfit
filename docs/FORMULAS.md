# Formulas, reference values and sources

LetsGetFit presents every figure as an estimate. This file records each equation's units, population, assumptions, limits and source. The same information is shown in the app under **Overview → How these estimates work**. When you change a formula, update the code, this file, `public/assets/js/ui/methods.js` and the tests together.

## Source check status

| Item | Source | Check status (9 November 2026) |
|---|---|---|
| CDC adult BMI categories | CDC, *Adult BMI Categories* (cdc.gov/bmi/adult-calculator/bmi-categories.html) | **Confirmed** against the CDC page text via web search: < 18.5; 18.5 to < 25; 25 to < 30; ≥ 30 with classes 1 (30 to < 35), 2 (35 to < 40) and 3 (≥ 40); adults 20 and older. |
| Mifflin–St Jeor equation and study population | Mifflin et al., *Am J Clin Nutr* 1990;51:241–247 | **Needs manual check.** Values are the standard published equation. The build environment could not open PubMed to re-read the abstract. |
| FAO/WHO/UNU PAL ranges | *Human energy requirements*, FAO 2004, Table 5.1 | **Needs manual check.** The build environment could not open fao.org. |
| EFSA reference values (protein, carbohydrate, fat, fibre) | EFSA NDA Panel opinions, 2010 and 2012 | **Needs manual check.** |
| EU energy conversion factors | Regulation (EU) No 1169/2011, Annex XIV | **Needs manual check.** |
| Compendium MET values | Ainsworth et al., *Med Sci Sports Exerc* 2011;43(8):1575–1581 | **Needs manual check.** Codes and values are from the 2011 Compendium. The 2024 Adult Compendium (Herrmann et al., *J Sport Health Sci* 2024;13(1):6–12) revises some values. Review it before launch, because pacompendium.com could not be opened from the build environment. |
| Healthy Ireland food pyramid servings | Department of Health / HSE, *Healthy Food for Life* | **Partly confirmed** via web search (5–7 vegetables and fruit; 3–5 cereals; 3 dairy; 2 protein; top shelf not needed). Re-check against the HSE leaflet. |

Before public launch, someone should open each primary source and tick it off here. The tests pin the exact values, so any correction shows up as a deliberate test change.

---

## Resting energy: Mifflin–St Jeor

```
REE (kcal/day) = 10 × weight (kg) + 6.25 × height (cm) − 5 × age (years) + s
s = +5   (male coefficient)
s = −161 (female coefficient)
```

- **Units:** kg, cm, whole years. Result in kcal/day, also shown in kJ (1 kcal = 4.184 kJ).
- **Population:** 498 healthy adults (251 men, 247 women) aged 19–78, normal-weight and obese, with resting energy measured by indirect calorimetry.
- **Terminology:** the study measured resting energy expenditure (REE). The app labels it "Resting energy (often called BMR)".
- **Assumptions:** the user can choose the coefficient that best matches their body. The app explains the two constants and points to a GP or dietitian when neither fits.
- **Limits:** a population estimate, and individuals differ. Not for pregnancy or breastfeeding, under-19s, or conditions that alter metabolism.
- **Display:** rounded to the nearest 10 kcal.
- **Code and tests:** `public/assets/js/lib/energy.js`, `tests/unit/energy.test.mjs`.

## Maintenance energy: activity level (PAL)

```
Maintenance (kcal/day) = REE × PAL
```

| App option | PAL | Basis (FAO/WHO/UNU 2004, Table 5.1) |
|---|---|---|
| Mostly seated | 1.40 | Lower bound of "sedentary or light activity" (1.40–1.69) |
| Lightly active | 1.55 | Midpoint of 1.40–1.69 |
| Moderately active | 1.85 | Midpoint of "active or moderately active" (1.70–1.99) |
| Very active | 2.20 | Midpoint of "vigorous or vigorously active" (2.00–2.40) |

- **Assumption:** FAO defines PAL as total energy expenditure divided by BMR. LetsGetFit uses the Mifflin–St Jeor REE in place of BMR, which is a common approximation.
- **No double counting:** the PAL already covers the user's usual exercise. Logged workouts are therefore never added to maintenance. Their estimates are shown separately and labelled.
- **Limits:** people often misjudge their activity, and the PAL choice moves the result more than any other input.

## BMI and adult categories

```
BMI = weight (kg) ÷ height (m)²
```

| Category | BMI |
|---|---|
| Underweight | < 18.5 |
| Healthy weight | 18.5 to < 25 |
| Overweight | 25 to < 30 |
| Obesity, class 1 | 30 to < 35 |
| Obesity, class 2 | 35 to < 40 |
| Obesity, class 3 | ≥ 40 |

- **Population:** adults aged 20 and older (CDC). No category is shown under 20.
- **Rounding:** BMI is shown to one decimal place, and the category uses that shown value. For example, 24.96 displays as 25.0 and is labelled overweight, so the label never contradicts the number.
- **Limits:** a screening measure only. It does not measure body fat, muscle, fitness or overall health. The app says this and does not infer any of them from BMI.

## Eligibility for the baseline calculator

- **Ages 20–78 inclusive.** This is the overlap of the CDC adult categories (20+) and the Mifflin–St Jeor study population (19–78).
- **Pregnancy or breastfeeding:** no estimates are shown, with a neutral message pointing to a GP, midwife or public health nurse.
- Out-of-range inputs are rejected before calculation: height 120–230 cm, weight 30–300 kg, age as a whole number 1–120. Eligibility is then checked separately.

## Maintenance-day nutrition example

An illustration inside adult reference ranges, not a target.

| Nutrient | Example rule | Reference |
|---|---|---|
| Protein | Higher of 15 % of energy or 0.83 g/kg | EFSA population reference intake 0.83 g/kg body weight/day |
| Fat | 30 % of energy | EFSA reference intake range 20–35 % of energy |
| Fibre | 25 g | EFSA adequate intake 25 g/day |
| Carbohydrate | Remaining energy | EFSA reference intake range 45–60 % of energy. A test checks the example stays inside it for typical inputs. |

Energy factors (EU 1169/2011): protein 4, carbohydrate 4, fat 9, fibre 2 kcal/g. Worked example for 2,500 kcal and 70 kg: protein 93.75 g, fat 83.3 g, fibre 25 g, carbohydrate (2500 − 375 − 750 − 50) ÷ 4 = 331.25 g, which is 53 % of energy.

Food examples follow the Healthy Ireland *Healthy Food for Life* food pyramid. The app does **not** offer weight-loss or weight-gain targets. Those will be a separate, reviewed feature with its own eligibility rules and safeguards.

## Workout active-energy estimate

```
Active kcal = (MET − 1) × weight (kg) × duration (hours)
```

- 1 MET is taken as 1 kcal/kg/h (the Compendium convention). Subtracting 1 MET gives the energy above rest, so the figure is net, not gross.
- The weight used is the calculator weight, or failing that, the latest weight log entry. The MET value, weight and result are saved with the entry, so old entries do not change if the table changes.
- Results are rounded to the nearest 5 kcal and labelled as an estimate that is not added to daily energy.
- "Other activity" has no MET value and no estimate.

## Unit conversions

| Conversion | Factor |
|---|---|
| inch → cm | 2.54 (exact) |
| pound → kg | 0.45359237 (exact) |
| stone → pound | 14 |
| kcal → kJ | 4.184 |

Imperial input is converted once on entry. Heights and weights are stored in cm and kg, rounded to 0.1. For example, 5 ft 9 in is stored as 175.3 cm and 12 st 8 lb as 79.8 kg. Tests check that converting back gives the same imperial value.

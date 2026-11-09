// "How these estimates work": the equation, units, population, assumptions, limits and source
// for every number the app shows. Keep in step with docs/FORMULAS.md.

import { h } from './dom.js';
import { ACTIVITY_LEVELS } from '../lib/energy.js';

const METHODS = [
  {
    title: 'Resting energy (Mifflin–St Jeor)',
    rows: [
      ['Equation', '10 × weight (kg) + 6.25 × height (cm) − 5 × age (years) + s, where s is +5 (male coefficient) or −161 (female coefficient)'],
      ['Result', 'Resting energy expenditure in kcal per day. It is commonly described as BMR (basal metabolic rate). 1 kcal = 4.184 kJ.'],
      ['Population', '498 healthy adults (251 men, 247 women) aged 19 to 78, normal-weight and obese, measured by indirect calorimetry.'],
      ['Limits', 'A population estimate. Individual results vary. Not developed for pregnancy, breastfeeding, people under 19, or people with conditions that change metabolism.'],
      ['Source', 'Mifflin MD, St Jeor ST, et al. A new predictive equation for resting energy expenditure in healthy individuals. Am J Clin Nutr. 1990;51(2):241–247.'],
    ],
  },
  {
    title: 'Maintenance energy (activity level)',
    rows: [
      ['Equation', 'Resting energy × physical activity level (PAL).'],
      ['Values used', ACTIVITY_LEVELS.map((l) => `${l.label}: ${l.pal.toFixed(2)}`).join(' · ')],
      ['Assumptions', 'PAL ranges from FAO/WHO/UNU: sedentary or light 1.40–1.69, active or moderately active 1.70–1.99, vigorous 2.00–2.40. PAL is defined relative to BMR; the Mifflin–St Jeor estimate is used in its place. Your usual exercise is part of the activity level, so logged workouts are not added again.'],
      ['Limits', 'Activity is hard to judge, and the choice of level changes the result more than any other input.'],
      ['Source', 'FAO/WHO/UNU. Human energy requirements: report of a joint expert consultation. Rome, 2004. Food and Nutrition Technical Report Series 1, Table 5.1.'],
    ],
  },
  {
    title: 'BMI and adult categories',
    rows: [
      ['Equation', 'Weight (kg) ÷ height (m)². Shown to one decimal place; the category uses the value shown.'],
      ['Categories', 'Underweight < 18.5 · Healthy weight 18.5 to < 25 · Overweight 25 to < 30 · Obesity ≥ 30 (class 1: 30 to < 35, class 2: 35 to < 40, class 3: ≥ 40).'],
      ['Population', 'Adults aged 20 and over. Under 20, BMI is interpreted with growth charts, which LetsGetFit does not provide.'],
      ['Limits', 'A screening measure. It does not measure body fat, muscle, fitness or overall health.'],
      ['Source', 'US Centers for Disease Control and Prevention. Adult BMI Categories.'],
    ],
  },
  {
    title: 'Maintenance-day nutrition example',
    rows: [
      ['Method', 'Protein: the higher of 15% of energy or 0.83 g per kg. Fat: 30% of energy. Fibre: 25 g. Carbohydrate: the remaining energy.'],
      ['Energy factors', 'Protein 4, carbohydrate 4, fat 9 and fibre 2 kcal per gram (EU Regulation 1169/2011, Annex XIV).'],
      ['Reference ranges', 'EFSA dietary reference values for adults: protein 0.83 g/kg/day (population reference intake); carbohydrate 45–60% of energy; fat 20–35% of energy; fibre 25 g/day (adequate intake).'],
      ['Limits', 'An illustration inside general ranges, not a personal prescription. Needs differ with health conditions, sport and age.'],
      ['Food guidance', 'Healthy Ireland, Department of Health and HSE: Healthy Food for Life food pyramid.'],
    ],
  },
  {
    title: 'Workout active-energy estimates',
    rows: [
      ['Equation', '(MET − 1) × weight (kg) × duration (hours). 1 MET is taken as 1 kcal per kg per hour; subtracting 1 removes resting energy.'],
      ['Values', 'MET values and activity codes from the Compendium of Physical Activities (Ainsworth et al., 2011).'],
      ['Limits', 'Average values for the activity, not a measurement of you. Shown for interest only and never added to your maintenance estimate.'],
    ],
  },
];

export function methodsSection() {
  return h(
    'section',
    { class: 'card methods', id: 'methods', 'aria-labelledby': 'methods-title' },
    h('h2', { id: 'methods-title', tabindex: '-1' }, 'How these estimates work'),
    h('p', {}, 'Every figure is an estimate from published research on groups of people. None of them is a diagnosis or medical advice.'),
    METHODS.map((m) =>
      h(
        'details',
        { class: 'disclosure' },
        h('summary', {}, m.title),
        h('dl', { class: 'method-list' }, m.rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
      ),
    ),
  );
}

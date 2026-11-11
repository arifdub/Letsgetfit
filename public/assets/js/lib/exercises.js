// Exercise library and starter routines.
//
// Content is general guidance for healthy adults, written in plain Irish English. It is not a
// personal programme. Cues focus on safe, controlled technique; every exercise lists easier or
// equipment-free substitutions so a routine can be done with what is available.
//
// logType decides what a set records:
//   'reps'  – repetitions only (bodyweight)
//   'load'  – repetitions and load in kg
//   'time'  – seconds (holds, carries)
//   'cardio' – minutes (machines, walking); counted as active minutes

export const EQUIPMENT = Object.freeze({
  none: 'No equipment',
  mat: 'Mat',
  chair: 'Chair or step',
  dumbbells: 'Dumbbells',
  kettlebell: 'Kettlebell',
  bench: 'Bench',
  barbell: 'Barbell',
  machine: 'Machine',
  cable: 'Cable machine',
  bar: 'Pull-up bar',
  band: 'Resistance band',
});

export const DIFFICULTY = Object.freeze({ beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' });
export const CATEGORIES = Object.freeze({ strength: 'Strength', core: 'Core', cardio: 'Cardio' });
export const LOG_TYPES = Object.freeze(['reps', 'load', 'time', 'cardio']);

export const EXERCISES = Object.freeze([
  // ---- Legs ----
  {
    id: 'bodyweight-squat', name: 'Bodyweight squat', category: 'strength', muscles: 'Thighs and glutes', equipment: ['none'], difficulty: 'beginner', logType: 'reps',
    cues: ['Feet about shoulder-width apart, toes turned out slightly.', 'Sit back and down as if onto a chair, keeping your chest up.', 'Keep your knees in line with your toes.', 'Push through your whole foot to stand.'],
    substitutions: ['chair-squat', 'goblet-squat', 'leg-press'],
  },
  {
    id: 'chair-squat', name: 'Sit-to-stand (chair squat)', category: 'strength', muscles: 'Thighs and glutes', equipment: ['chair'], difficulty: 'beginner', logType: 'reps',
    cues: ['Sit on the front of a sturdy chair, feet flat.', 'Lean forward slightly and stand up without using your hands if you can.', 'Lower slowly until you lightly touch the seat.'],
    substitutions: ['bodyweight-squat'],
  },
  {
    id: 'goblet-squat', name: 'Goblet squat', category: 'strength', muscles: 'Thighs and glutes', equipment: ['dumbbells', 'kettlebell'], difficulty: 'beginner', logType: 'load',
    cues: ['Hold one dumbbell or kettlebell close to your chest.', 'Squat down between your knees, keeping your elbows inside them.', 'Keep your back long and heels down.', 'Stand tall and squeeze your glutes at the top.'],
    substitutions: ['bodyweight-squat', 'leg-press', 'back-squat'],
  },
  {
    id: 'back-squat', name: 'Barbell back squat', category: 'strength', muscles: 'Thighs and glutes', equipment: ['barbell'], difficulty: 'intermediate', logType: 'load',
    cues: ['Set the bar on your upper back, not your neck, in a rack with safety bars set.', 'Brace your stomach before each repetition.', 'Squat to a depth you can control with a neutral back.', 'Drive up with the bar moving in a straight line over mid-foot.'],
    substitutions: ['goblet-squat', 'leg-press'],
  },
  {
    id: 'leg-press', name: 'Leg press', category: 'strength', muscles: 'Thighs and glutes', equipment: ['machine'], difficulty: 'beginner', logType: 'load',
    cues: ['Feet shoulder-width apart in the middle of the platform.', 'Lower until your knees are bent to about 90 degrees, keeping your lower back on the pad.', 'Press through your heels without locking your knees hard.'],
    substitutions: ['goblet-squat', 'bodyweight-squat'],
  },
  {
    id: 'reverse-lunge', name: 'Reverse lunge', category: 'strength', muscles: 'Thighs and glutes', equipment: ['none', 'dumbbells'], difficulty: 'beginner', logType: 'reps',
    cues: ['Step one foot back and lower until both knees are bent.', 'Keep most of your weight on the front foot.', 'Push through the front heel to return. Count each side.', 'Hold a wall or chair for balance if needed.'],
    substitutions: ['split-squat', 'step-up'],
  },
  {
    id: 'split-squat', name: 'Split squat', category: 'strength', muscles: 'Thighs and glutes', equipment: ['none', 'dumbbells'], difficulty: 'beginner', logType: 'reps',
    cues: ['Stand in a long stride, back heel lifted.', 'Lower straight down, then rise, without moving your feet.', 'Keep your front knee over your foot.'],
    substitutions: ['reverse-lunge', 'chair-squat'],
  },
  {
    id: 'step-up', name: 'Step-up', category: 'strength', muscles: 'Thighs and glutes', equipment: ['chair'], difficulty: 'beginner', logType: 'reps',
    cues: ['Use a stable step or bottom stair.', 'Place your whole foot on the step and press through it to stand up.', 'Step down slowly. Count each side.'],
    substitutions: ['reverse-lunge', 'chair-squat'],
  },
  {
    id: 'glute-bridge', name: 'Glute bridge', category: 'strength', muscles: 'Glutes and hamstrings', equipment: ['mat'], difficulty: 'beginner', logType: 'reps',
    cues: ['Lie on your back, knees bent, feet flat and hip-width apart.', 'Press through your heels to lift your hips until your body is in a line from knees to shoulders.', 'Pause, then lower with control. Avoid arching your lower back.'],
    substitutions: ['dumbbell-rdl', 'leg-curl'],
  },
  {
    id: 'dumbbell-rdl', name: 'Romanian deadlift (dumbbells)', category: 'strength', muscles: 'Hamstrings, glutes and back', equipment: ['dumbbells'], difficulty: 'intermediate', logType: 'load',
    cues: ['Stand tall with dumbbells in front of your thighs, knees softly bent.', 'Push your hips back and slide the weights down your legs, keeping your back flat.', 'Stop when you feel a stretch in your hamstrings, then drive your hips forward to stand.'],
    substitutions: ['glute-bridge', 'leg-curl'],
  },
  {
    id: 'leg-curl', name: 'Leg curl (machine)', category: 'strength', muscles: 'Hamstrings', equipment: ['machine'], difficulty: 'beginner', logType: 'load',
    cues: ['Line your knees up with the machine’s pivot.', 'Curl the pad towards you smoothly, then return slowly.', 'Keep your hips down on the pad.'],
    substitutions: ['glute-bridge', 'dumbbell-rdl'],
  },
  {
    id: 'calf-raise', name: 'Calf raise', category: 'strength', muscles: 'Calves', equipment: ['none'], difficulty: 'beginner', logType: 'reps',
    cues: ['Stand tall, holding a wall for balance.', 'Rise onto the balls of your feet, pause, then lower slowly.'],
    substitutions: ['step-up'],
  },
  // ---- Push ----
  {
    id: 'hindu-push-up', name: 'Hindu push-up', category: 'strength', muscles: 'Chest, shoulders, triceps and back', equipment: ['none'], difficulty: 'intermediate', logType: 'reps',
    cues: ['Start in a push-up position, then push your hips up and back so your body makes an upside-down V.', 'Bend your elbows and sweep your chest forward, low over the floor between your hands.', 'Straighten your arms to lift your chest with your hips low, then return to the start.'],
    substitutions: ['push-up', 'incline-push-up'],
  },
  {
    id: 'push-up', name: 'Push-up', category: 'strength', muscles: 'Chest, shoulders and triceps', equipment: ['none'], difficulty: 'intermediate', logType: 'reps',
    cues: ['Hands slightly wider than shoulders, body in a straight line from head to heels.', 'Lower your chest towards the floor with elbows at about 45 degrees.', 'Push the floor away to return, keeping your hips level.'],
    substitutions: ['incline-push-up', 'dumbbell-floor-press', 'machine-chest-press'],
  },
  {
    id: 'incline-push-up', name: 'Incline push-up', category: 'strength', muscles: 'Chest, shoulders and triceps', equipment: ['chair'], difficulty: 'beginner', logType: 'reps',
    cues: ['Place your hands on a kitchen counter, wall or sturdy table.', 'Keep your body straight and lower your chest to the edge.', 'The higher the surface, the easier it is.'],
    substitutions: ['push-up', 'dumbbell-floor-press'],
  },
  {
    id: 'dumbbell-floor-press', name: 'Dumbbell floor press', category: 'strength', muscles: 'Chest and triceps', equipment: ['dumbbells', 'mat'], difficulty: 'beginner', logType: 'load',
    cues: ['Lie on your back, knees bent, a dumbbell in each hand above your chest.', 'Lower until your upper arms touch the floor, elbows at about 45 degrees.', 'Press back up without banging the weights together.'],
    substitutions: ['push-up', 'bench-press', 'machine-chest-press'],
  },
  {
    id: 'bench-press', name: 'Bench press', category: 'strength', muscles: 'Chest, shoulders and triceps', equipment: ['barbell', 'bench'], difficulty: 'intermediate', logType: 'load',
    cues: ['Use safety bars or a spotter.', 'Feet flat, shoulder blades squeezed together.', 'Lower the bar to your lower chest with control, then press up.'],
    substitutions: ['dumbbell-floor-press', 'machine-chest-press', 'push-up'],
  },
  {
    id: 'machine-chest-press', name: 'Chest press (machine)', category: 'strength', muscles: 'Chest, shoulders and triceps', equipment: ['machine'], difficulty: 'beginner', logType: 'load',
    cues: ['Set the seat so the handles are level with your mid-chest.', 'Press forward smoothly without locking your elbows.', 'Return slowly until you feel a light stretch.'],
    substitutions: ['dumbbell-floor-press', 'push-up'],
  },
  {
    id: 'dumbbell-shoulder-press', name: 'Dumbbell shoulder press', category: 'strength', muscles: 'Shoulders and triceps', equipment: ['dumbbells'], difficulty: 'beginner', logType: 'load',
    cues: ['Sit or stand tall with dumbbells at shoulder height.', 'Press up until your arms are straight, without arching your back.', 'Lower with control.'],
    substitutions: ['incline-push-up', 'machine-chest-press'],
  },
  // ---- Pull ----
  {
    id: 'one-arm-row', name: 'One-arm dumbbell row', category: 'strength', muscles: 'Upper back and biceps', equipment: ['dumbbells', 'bench'], difficulty: 'beginner', logType: 'load',
    cues: ['Support yourself with one hand and knee on a bench or chair, back flat.', 'Pull the dumbbell towards your hip, elbow close to your side.', 'Lower slowly. Count each side.'],
    substitutions: ['band-row', 'seated-cable-row', 'lat-pulldown'],
  },
  {
    id: 'band-row', name: 'Resistance band row', category: 'strength', muscles: 'Upper back and biceps', equipment: ['band'], difficulty: 'beginner', logType: 'reps',
    cues: ['Anchor the band at chest height, or loop it around your feet while sitting.', 'Pull your elbows back and squeeze your shoulder blades together.', 'Return slowly.'],
    substitutions: ['one-arm-row', 'seated-cable-row'],
  },
  {
    id: 'seated-cable-row', name: 'Seated cable row', category: 'strength', muscles: 'Upper back and biceps', equipment: ['cable'], difficulty: 'beginner', logType: 'load',
    cues: ['Sit tall with knees softly bent.', 'Pull the handle to your lower ribs, keeping your torso still.', 'Let your arms straighten slowly without rounding your back.'],
    substitutions: ['one-arm-row', 'band-row', 'lat-pulldown'],
  },
  {
    id: 'lat-pulldown', name: 'Lat pulldown', category: 'strength', muscles: 'Back and biceps', equipment: ['cable', 'machine'], difficulty: 'beginner', logType: 'load',
    cues: ['Grip slightly wider than your shoulders and sit with thighs under the pads.', 'Pull the bar to your upper chest, leading with your elbows.', 'Let the bar rise slowly until your arms are straight.'],
    substitutions: ['assisted-pull-up', 'one-arm-row', 'band-row'],
  },
  {
    id: 'assisted-pull-up', name: 'Assisted pull-up', category: 'strength', muscles: 'Back and biceps', equipment: ['machine', 'bar', 'band'], difficulty: 'intermediate', logType: 'reps',
    cues: ['Use an assisted machine or a band looped over the bar.', 'Start from straight arms and pull until your chin passes the bar.', 'Lower all the way with control.'],
    substitutions: ['lat-pulldown', 'one-arm-row'],
  },
  // ---- Core and carries ----
  {
    id: 'plank', name: 'Plank', category: 'core', muscles: 'Core', equipment: ['mat'], difficulty: 'beginner', logType: 'time',
    cues: ['Forearms on the floor under your shoulders, body in a straight line.', 'Squeeze your glutes and brace your stomach.', 'Breathe steadily. Drop to your knees to make it easier.'],
    substitutions: ['dead-bug', 'bird-dog'],
  },
  {
    id: 'side-plank', name: 'Side plank', category: 'core', muscles: 'Core (sides)', equipment: ['mat'], difficulty: 'beginner', logType: 'time',
    cues: ['Lie on your side, elbow under your shoulder.', 'Lift your hips so your body is in a straight line.', 'Bend your knees to make it easier. Time each side.'],
    substitutions: ['plank', 'bird-dog'],
  },
  {
    id: 'dead-bug', name: 'Dead bug', category: 'core', muscles: 'Core', equipment: ['mat'], difficulty: 'beginner', logType: 'reps',
    cues: ['Lie on your back, arms up and knees bent over your hips.', 'Keep your lower back gently pressed to the floor.', 'Slowly lower the opposite arm and leg, then switch. Count each side.'],
    substitutions: ['bird-dog', 'plank'],
  },
  {
    id: 'bird-dog', name: 'Bird dog', category: 'core', muscles: 'Core and back', equipment: ['mat'], difficulty: 'beginner', logType: 'reps',
    cues: ['On hands and knees, back flat.', 'Reach one arm forward and the opposite leg back without twisting.', 'Pause, return, then switch. Count each side.'],
    substitutions: ['dead-bug', 'plank'],
  },
  {
    id: 'back-extension', name: 'Back extension (Superman)', category: 'core', muscles: 'Lower back and glutes', equipment: ['none'], difficulty: 'beginner', logType: 'reps',
    cues: ['Lie face down with your arms stretched out in front of you.', 'Lift your chest, arms and legs a little off the floor, squeezing your glutes.', 'Pause for a moment, then lower with control. Keep your neck long and look at the floor.'],
    substitutions: ['bird-dog', 'glute-bridge'],
  },
  {
    id: 'farmers-carry', name: 'Farmer’s carry', category: 'core', muscles: 'Grip, shoulders and core', equipment: ['dumbbells', 'kettlebell'], difficulty: 'beginner', logType: 'time',
    cues: ['Hold a weight in each hand by your sides.', 'Walk tall with your shoulders back and down.', 'Take short, steady steps. Record the time.'],
    substitutions: ['plank', 'side-plank'],
  },
  // ---- Cardio ----
  {
    id: 'brisk-walk', name: 'Brisk walk', category: 'cardio', muscles: 'Whole body', equipment: ['none'], difficulty: 'beginner', logType: 'cardio', activityId: 'walk-brisk',
    cues: ['Walk at a pace where you can talk but not sing.', 'Swing your arms naturally and stand tall.'],
    substitutions: ['exercise-bike', 'rowing-machine'],
  },
  {
    id: 'exercise-bike', name: 'Exercise bike', category: 'cardio', muscles: 'Legs and heart', equipment: ['machine'], difficulty: 'beginner', logType: 'cardio', activityId: 'cycle-stationary',
    cues: ['Set the seat so your knee is slightly bent at the bottom of the pedal stroke.', 'Start easy for a few minutes, then build to a steady effort.'],
    substitutions: ['brisk-walk', 'rowing-machine'],
  },
  {
    id: 'rowing-machine', name: 'Rowing machine', category: 'cardio', muscles: 'Legs, back and heart', equipment: ['machine'], difficulty: 'beginner', logType: 'cardio', activityId: 'rowing-machine',
    cues: ['Push with your legs first, then lean back slightly, then pull with your arms.', 'Return in the reverse order: arms, body, legs.', 'Keep a steady, comfortable rhythm.'],
    substitutions: ['exercise-bike', 'brisk-walk'],
  },
]);

// Prescriptions are general starting points. "8–12" means choose a load or version you can do
// for that many repetitions with good form, stopping with 1–3 repetitions in reserve.
export const ROUTINES = Object.freeze([
  {
    id: 'no-equipment-three', name: 'No-equipment three', location: 'home', difficulty: 'beginner', minutes: 12,
    equipmentSummary: 'No equipment',
    description: 'Three classic moves you can do anywhere: squat, push-up and Hindu push-up.',
    exercises: [
      { exerciseId: 'bodyweight-squat', sets: 3, target: '10–12 reps' },
      { exerciseId: 'push-up', sets: 3, target: '6–10 reps' },
      { exerciseId: 'hindu-push-up', sets: 3, target: '6–10 reps' },
    ],
  },
  {
    id: 'home-starter', name: 'Home starter', location: 'home', difficulty: 'beginner', minutes: 25,
    equipmentSummary: 'No equipment (a chair and a mat help)',
    description: 'A gentle full-body session for getting started at home. Two rounds of each exercise.',
    exercises: [
      { exerciseId: 'bodyweight-squat', sets: 2, target: '10–12 reps' },
      { exerciseId: 'incline-push-up', sets: 2, target: '8–12 reps' },
      { exerciseId: 'glute-bridge', sets: 2, target: '10–15 reps' },
      { exerciseId: 'reverse-lunge', sets: 2, target: '6–10 each side' },
      { exerciseId: 'bird-dog', sets: 2, target: '6–8 each side' },
      { exerciseId: 'plank', sets: 2, target: '20–30 seconds' },
    ],
  },
  {
    id: 'home-dumbbell', name: 'Home with dumbbells', location: 'home', difficulty: 'beginner', minutes: 35,
    equipmentSummary: 'A pair of dumbbells, a mat, a sturdy chair',
    description: 'Full body with dumbbells. Pick weights you could lift 1–3 more times at the end of each set.',
    exercises: [
      { exerciseId: 'goblet-squat', sets: 3, target: '8–12 reps' },
      { exerciseId: 'dumbbell-floor-press', sets: 3, target: '8–12 reps' },
      { exerciseId: 'one-arm-row', sets: 3, target: '8–12 each side' },
      { exerciseId: 'dumbbell-rdl', sets: 3, target: '8–12 reps' },
      { exerciseId: 'dumbbell-shoulder-press', sets: 2, target: '8–12 reps' },
      { exerciseId: 'dead-bug', sets: 2, target: '6–8 each side' },
    ],
  },
  {
    id: 'gym-a', name: 'Gym full body A', location: 'gym', difficulty: 'beginner', minutes: 45,
    equipmentSummary: 'Machines, cables, dumbbells',
    description: 'Machine-based full-body session. Alternate with B, for example Monday and Thursday.',
    exercises: [
      { exerciseId: 'leg-press', sets: 3, target: '10–12 reps' },
      { exerciseId: 'machine-chest-press', sets: 3, target: '8–12 reps' },
      { exerciseId: 'lat-pulldown', sets: 3, target: '8–12 reps' },
      { exerciseId: 'dumbbell-rdl', sets: 3, target: '8–12 reps' },
      { exerciseId: 'plank', sets: 2, target: '20–40 seconds' },
    ],
  },
  {
    id: 'gym-b', name: 'Gym full body B', location: 'gym', difficulty: 'beginner', minutes: 45,
    equipmentSummary: 'Dumbbells, cables, machines',
    description: 'The second full-body session to alternate with A.',
    exercises: [
      { exerciseId: 'goblet-squat', sets: 3, target: '8–12 reps' },
      { exerciseId: 'seated-cable-row', sets: 3, target: '10–12 reps' },
      { exerciseId: 'dumbbell-shoulder-press', sets: 3, target: '8–12 reps' },
      { exerciseId: 'leg-curl', sets: 2, target: '10–15 reps' },
      { exerciseId: 'farmers-carry', sets: 3, target: '30–40 seconds' },
      { exerciseId: 'side-plank', sets: 2, target: '15–30 seconds each side' },
    ],
  },
  {
    id: 'core-15', name: 'Core in 15 minutes', location: 'home', difficulty: 'beginner', minutes: 15,
    equipmentSummary: 'A mat',
    description: 'A short core session you can add to any day.',
    exercises: [
      { exerciseId: 'dead-bug', sets: 2, target: '6–8 each side' },
      { exerciseId: 'bird-dog', sets: 2, target: '6–8 each side' },
      { exerciseId: 'side-plank', sets: 2, target: '15–30 seconds each side' },
      { exerciseId: 'glute-bridge', sets: 2, target: '10–15 reps' },
    ],
  },
]);

export function getExercise(id) {
  return EXERCISES.find((e) => e.id === id) ?? null;
}

export function getRoutine(id) {
  return ROUTINES.find((r) => r.id === id) ?? null;
}

/** Filter the library by free text, equipment group and category. */
export function filterExercises({ text = '', equipment = 'all', category = 'all' } = {}) {
  const q = text.trim().toLowerCase();
  const homeKit = new Set(['none', 'mat', 'chair', 'band']);
  return EXERCISES.filter((e) => {
    if (category !== 'all' && e.category !== category) return false;
    if (equipment === 'bodyweight' && !e.equipment.some((k) => homeKit.has(k))) return false;
    if (equipment === 'dumbbells' && !e.equipment.some((k) => k === 'dumbbells' || k === 'kettlebell')) return false;
    if (equipment === 'gym' && !e.equipment.some((k) => ['machine', 'cable', 'barbell', 'bench', 'bar'].includes(k))) return false;
    if (q && !`${e.name} ${e.muscles}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export const SAFETY_NOTE =
  'Warm up for 5–10 minutes first. Stop if you feel sharp pain, chest pain, dizziness or unusual breathlessness. If you have a health condition, are pregnant, have had a recent injury or are returning to exercise after a long break, check with your GP or a physiotherapist first.';

// WHO 2020 physical activity guidelines for adults 18–64 (also used by the HSE):
// at least 150–300 minutes of moderate-intensity activity a week (or 75–150 vigorous),
// plus muscle-strengthening activities on 2 or more days a week.
export const ACTIVITY_GUIDELINE = Object.freeze({ moderateMinutes: 150, strengthDays: 2 });

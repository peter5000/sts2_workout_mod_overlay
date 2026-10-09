import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const fixturesMap: Record<number, string> = {
  0: '00_run_start.json',
  1: '01_floor_1_combat.json',
  2: '02_floor_2_event.json',
  3: '03_floor_6_death.json',
  4: '04_run_victory.json',
  5: '05_run_defeat.json'
};

function main() {
  const args = process.argv.slice(2);
  let stepArg = 1;

  const stepIndex = args.indexOf('--step');
  if (stepIndex !== -1 && args[stepIndex + 1]) {
    stepArg = parseInt(args[stepIndex + 1], 10);
  }

  const fixtureFileName = fixturesMap[stepArg];
  if (!fixtureFileName) {
    console.error(`[SIMULATOR ERROR] Invalid step: ${stepArg}. Available steps: 0, 1, 2, 3, 4, 5`);
    process.exit(1);
  }

  const fixturePath = path.join(process.cwd(), 'samples', fixtureFileName);
  if (!fs.existsSync(fixturePath)) {
    console.error(`[SIMULATOR ERROR] Fixture file not found: ${fixturePath}`);
    process.exit(1);
  }

  const targetDir = process.env.STS2_SAVE_DIR || path.join(process.cwd(), 'test_saves');
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const targetSavePath = path.join(targetDir, 'current_run.save');
  const tempSavePath = path.join(targetDir, 'current_run.save.tmp');

  const content = fs.readFileSync(fixturePath, 'utf-8');

  // Perform atomic write
  fs.writeFileSync(tempSavePath, content, 'utf-8');
  fs.renameSync(tempSavePath, targetSavePath);

  console.log(`\n✅ [SIMULATOR SUCCESS] Step ${stepArg} applied!`);
  console.log(`   Fixture Source : ${fixtureFileName}`);
  console.log(`   Target Save    : ${targetSavePath}\n`);
}

main();

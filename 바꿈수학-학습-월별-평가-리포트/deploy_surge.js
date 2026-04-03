const { spawn } = require('child_process');

const surge = spawn('npx', ['surge', '../', 'bahkkum.surge.sh'], { shell: true });

surge.stdout.on('data', data => {
  const output = data.toString();
  console.log('STDOUT:', output);
  
  if (output.toLowerCase().includes('email:')) {
    surge.stdin.write('dndsu2810.bahkkum@example.com\n');
  } else if (output.toLowerCase().includes('password:')) {
    surge.stdin.write('바꿈수학1234\n');
  }
});

surge.stderr.on('data', data => {
  console.error('STDERR:', data.toString());
});

surge.on('close', code => {
  console.log(`Surge completed with code ${code}`);
});

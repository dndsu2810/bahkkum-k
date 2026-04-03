const { spawn } = require('child_process');

const surge = spawn('npx', ['surge', 'dist', 'dndsu2810-bahkkum.surge.sh'], { shell: true });

surge.stdout.on('data', data => {
  const output = data.toString();
  console.log('STDOUT:', output);
  
  if (output.toLowerCase().includes('email:')) {
    surge.stdin.write('dndsu2810.bahkkum@example.com\n');
  } else if (output.toLowerCase().includes('password:')) {
    surge.stdin.write('bahkkumreport1234\n');
  }
});

// STDERR output disabled to prevent confusing warnings
surge.stderr.on('data', () => {});

surge.on('close', code => {
  console.log(`Surge completed with code ${code}`);
});

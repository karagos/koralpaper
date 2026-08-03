#!/usr/bin/env node
/* Dev-only harness: spawns the bridge server and forwards JSON-RPC lines
   from a command file to its stdin, appending stdout replies to an output
   file. Lets an agent (or a human with two terminals) drive the MCP side
   while the real app is connected in a browser.
   Usage: node test-harness.js <cmdFile> <outFile> */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const [cmdFile, outFile] = process.argv.slice(2);
if (!cmdFile || !outFile){ console.error('usage: test-harness.js <cmdFile> <outFile>'); process.exit(1); }
fs.writeFileSync(cmdFile, '');
fs.writeFileSync(outFile, '');

const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
  stdio: ['pipe', 'pipe', 'inherit'],
});
child.stdout.on('data', d => fs.appendFileSync(outFile, d));
child.on('exit', c => process.exit(c || 0));

let sent = 0;
setInterval(() => {
  const lines = fs.readFileSync(cmdFile, 'utf8').split('\n').filter(l => l.trim());
  while (sent < lines.length){
    child.stdin.write(lines[sent] + '\n');
    sent++;
  }
}, 250);
console.log('harness up, pid', child.pid);

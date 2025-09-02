const bcrypt = require('bcryptjs');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('Введите пароль для админ-панели: ', async (password) => {
  const saltRounds = 12;
  const hash = await bcrypt.hash(password, saltRounds);
  console.log(`\nХеш пароля: ${hash}`);
  console.log('Добавьте это значение в web/.env файл как ADMIN_PASSWORD_HASH');
  rl.close();
});
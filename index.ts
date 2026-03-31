import { login } from './login';
import { listChats } from './list-chats';
import { readHistory } from './read-history';

const [,, command, ...args] = process.argv;

(async () => {
  switch (command) {
    case 'login':
      await login();
      break;
    case 'list-chats':
      await listChats();
      break;
    case 'read-history': {
      const url = args[0];
      if (!url) {
        process.stderr.write('Usage: bun index.ts read-history <url> [limit]\n');
        process.stderr.write('  limit: message count (number) or date cutoff (YYYY-MM-DD)\n');
        process.exit(1);
      }
      await readHistory(url, args[1]);
      break;
    }
    default:
      process.stderr.write('Usage: bun index.ts <login|list-chats|read-history> [...args]\n');
      process.exit(1);
  }
})();

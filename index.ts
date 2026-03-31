import { login } from "./login";
import { syncAll } from "./sync";
import { analyze } from "./analyze";

const [, , command] = process.argv;

(async () => {
  switch (command) {
    case "login":
      await login();
      break;
    case "sync":
      await syncAll();
      break;
    case "analyze":
      await analyze();
      break;
    default:
      process.stderr.write("Usage: bun index.ts <login|sync|analyze>\n");
      process.exit(1);
  }
})();

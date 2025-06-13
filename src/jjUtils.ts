import { execFile } from "child_process"; // Changed from 'exec' to 'execFile'
import type { LogEntry } from "./jjTypes";

export function getLogOutput(): Promise<LogEntry[]> {
  return new Promise((resolve, reject) => {
    const jjTemplate = `'{ "commit_id":' ++ commit_id.short().escape_json() ++ ', ' ++ '"change_id":' 
++ change_id.short().escape_json() ++ ', ' ++ '"author_name":' ++ author.name().escape_json() ++ 
', ' ++ '"author_email":' ++ stringify(author.email().local() ++ '@' ++
author.email().domain()).escape_json() ++ ', ' ++ '"description_first_line":' ++ 
description.first_line().trim().escape_json() ++ ', ' ++ '"parents": [' ++ parents.map(|p| 
p.commit_id().short().escape_json()).join(",") ++ '], ' ++ '"local_bookmarks": [' ++ 
local_bookmarks.map(|b| b.name().escape_json()).join(",") ++ '], ' ++ '"remote_bookmarks": [' ++
remote_bookmarks.map(|b| stringify(b.name() ++ '@' ++ b.remote()).escape_json()).join(",") ++ 
'], ' ++ '"is_current_working_copy":' ++ current_working_copy ++ ' }\n'`;

    execFile(
      "/Users/keane/code/jj-v0.30.0-aarch64-apple-darwin",
      ["log", "--no-graph", "-T", jjTemplate],
      (error, stdout, stderr) => {
        if (error) {
          console.error(`execFile error: ${(error as Error).toString()}`);
          return reject(error as Error);
        }
        if (stderr) {
          console.error(`stderr: ${stderr}`);
        }

        resolve(
          stdout
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line) as LogEntry),
        );
      },
    );
  });
}

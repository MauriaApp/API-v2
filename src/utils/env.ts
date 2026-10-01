import dotenv from "dotenv";

// Must be the first import of src/index.ts: every module reading process.env
// (Sentry included) needs .env / .env.dev loaded beforehand.
const isDev = !!process.env.TS_NODE_DEV;
const envFile = isDev ? ".env.dev" : ".env";
dotenv.config({ path: envFile, override: true, quiet: true });

if (isDev) {
    console.log("-- Running in development mode");
}

export { isDev };

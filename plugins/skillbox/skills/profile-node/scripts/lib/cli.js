// A failure meant for the person running the script. Thrown rather than exiting
// on the spot, so the logic can be exercised from tests; runMain turns it into
// the printed error and exit code 1. Anything else propagates as a crash.
class CliError extends Error {}

// main may be sync or async. The exit code is set, not forced, so output still
// in flight to a pipe is not cut off.
function runMain(main) {
  Promise.resolve()
    .then(main)
    .catch((e) => {
      if (!(e instanceof CliError)) throw e;
      console.error(`Error: ${e.message}`);
      process.exitCode = 1;
    });
}

module.exports = { CliError, runMain };

// Desk server modules take runtime configuration from the environment, and the
// view store clears its state directory as soon as `@/server/routes` loads.
// Tests configure what they need, so a shell pointed at a live stack must not
// reach its Hermes, credentials or view state. Qualification inputs are
// explicit opt-ins and stay.
for (const name of Object.keys(process.env))
  if (
    /^(?:PYTHIA_|HERMES_|API_SERVER_)/u.test(name) &&
    !name.startsWith("PYTHIA_QUALIFICATION_")
  )
    delete process.env[name];

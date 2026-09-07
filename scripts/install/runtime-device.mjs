import {
  readJsonIfPresent,
  transactionReceipt,
  writeTransaction,
} from "./files.mjs";
import { serviceAction } from "./systemd.mjs";
import {
  assertInstallationSource,
  inspectInstallationSource,
  recordInstallation,
} from "./runtime-source.mjs";
import {
  ensureLinger,
  prepareInstallation,
  startAndVerify,
} from "./runtime-prepare.mjs";

export async function installDevice(paths, channel, dependencies = {}) {
  if (!["stable", "preview"].includes(channel)) {
    throw new Error("Install channel must be stable or preview.");
  }
  const expectedRevision = dependencies.expectedRevision;
  if (!/^[0-9a-f]{40,64}$/u.test(expectedRevision ?? "")) {
    throw new Error("The verified installation revision is required.");
  }
  const prepare = dependencies.prepare ?? prepareInstallation;
  const start =
    dependencies.startAndVerify ??
    ((currentPaths) =>
      startAndVerify(currentPaths, { enableAfterVerify: false }));
  const enable =
    dependencies.enable ??
    (dependencies.startAndVerify
      ? () => undefined
      : () => serviceAction("enable"));
  const linger = dependencies.ensureLinger ?? ensureLinger;
  const record = dependencies.recordInstallation ?? recordInstallation;
  const stop = dependencies.stop ?? (() => serviceAction("stop"));
  const verifySource =
    dependencies.verifySource ??
    (() =>
      assertInstallationSource(paths, channel, expectedRevision, {
        allowLocal: channel === "preview",
      }));
  const existing = readJsonIfPresent(paths.installFile);
  const interrupted = transactionReceipt(paths).value;
  if (existing) {
    const recoverable =
      interrupted?.operation === "install" &&
      interrupted.channel === channel &&
      interrupted.new_revision === expectedRevision &&
      existing.checkout === paths.checkout &&
      existing.channel === channel &&
      existing.revision === expectedRevision &&
      ["recording", "complete", "failed-stopped"].includes(interrupted.phase);
    if (!recoverable) {
      throw new Error("Pythia is already installed. Use 'pythia update'.");
    }
    try {
      await stop();
      await verifySource();
      await start(paths);
      const lingerStatus = await linger();
      await verifySource();
      writeTransaction(paths, {
        ...interrupted,
        phase: "complete",
        services: "running",
        error_code: null,
        error_message: null,
      });
      await enable();
      return {
        installed: true,
        recovered: true,
        channel,
        revision: expectedRevision,
        linger: lingerStatus,
        desk_url: `http://127.0.0.1:${paths.ports.desk}`,
      };
    } catch (error) {
      let stopConfirmed = false;
      try {
        await stop();
        stopConfirmed = true;
      } catch {
        // The receipt reports an unconfirmed stop below.
      }
      writeTransaction(paths, {
        ...interrupted,
        phase: "failed-stopped",
        services: stopConfirmed ? "stopped" : "stop-unconfirmed",
        error_code: "install_recovery_failed",
        error_message:
          error instanceof Error ? error.message : "Install recovery failed.",
      });
      throw error;
    }
  }
  const transaction = writeTransaction(paths, {
    transaction_id: `install-${Date.now()}-${process.pid}`,
    operation: "install",
    channel,
    new_revision: expectedRevision,
    phase: "preparing",
    services: "stopped",
  });
  try {
    await stop();
    const prepared = await prepare(paths, channel, expectedRevision, {
      allowLocal: channel === "preview",
    });
    if (prepared.revision !== expectedRevision) {
      throw new Error("Prepared source does not match the verified revision.");
    }
    await verifySource();
    writeTransaction(paths, {
      ...transaction,
      new_revision: prepared.revision,
      phase: "prepared",
      services: "stopped",
    });
    await start(paths);
    const lingerStatus = await linger();
    await verifySource();
    writeTransaction(paths, {
      ...transaction,
      new_revision: prepared.revision,
      phase: "recording",
      services: "running",
    });
    record(paths, channel, prepared.revision, {
      kind: channel === "preview" ? "chosen-source" : "release",
      ...prepared.source,
    });
    await dependencies.afterRecord?.();
    writeTransaction(paths, {
      ...transaction,
      new_revision: prepared.revision,
      phase: "complete",
      services: "running",
    });
    await enable();
    return {
      installed: true,
      channel,
      revision: prepared.revision,
      linger: lingerStatus,
      desk_url: `http://127.0.0.1:${paths.ports.desk}`,
    };
  } catch (error) {
    let stopConfirmed = false;
    try {
      await stop();
      stopConfirmed = true;
    } catch {
      // A failed initial start is already stopped.
    }
    writeTransaction(paths, {
      ...transaction,
      phase: "failed-stopped",
      services: stopConfirmed ? "stopped" : "stop-unconfirmed",
      error_code: "install_failed",
      error_message: error instanceof Error ? error.message : "Install failed.",
    });
    throw error;
  }
}

export async function rebuildDevice(paths, dependencies = {}) {
  const installation = readJsonIfPresent(paths.installFile);
  if (!installation || installation.checkout !== paths.checkout) {
    throw new Error("Pythia installation ownership is missing or changed.");
  }
  const source = inspectInstallationSource(paths);
  const stop = dependencies.stop ?? (() => serviceAction("stop"));
  const prepare = dependencies.prepare ?? prepareInstallation;
  const start =
    dependencies.startAndVerify ??
    ((currentPaths) =>
      startAndVerify(currentPaths, { enableAfterVerify: false }));
  const enable =
    dependencies.enable ??
    (dependencies.startAndVerify
      ? () => undefined
      : () => serviceAction("enable"));
  const record = dependencies.recordInstallation ?? recordInstallation;
  const transaction = writeTransaction(paths, {
    transaction_id: `rebuild-${Date.now()}-${process.pid}`,
    operation: "rebuild",
    channel: installation.channel,
    old_revision: installation.revision,
    new_revision: source.revision,
    phase: "stopping",
    services: "stopping",
  });
  try {
    await stop();
    writeTransaction(paths, {
      ...transaction,
      phase: "stopped",
      services: "stopped",
    });
    const prepared = await prepare(
      paths,
      installation.channel,
      source.revision,
      {
        allowLocal: true,
      },
    );
    writeTransaction(paths, {
      ...transaction,
      phase: "prepared",
      services: "stopped",
    });
    await start(paths);
    const finalSource = inspectInstallationSource(paths);
    if (finalSource.revision !== source.revision) {
      throw new Error("The chosen source revision changed during rebuild.");
    }
    record(paths, installation.channel, prepared.revision, {
      kind: "chosen-source",
      ...finalSource,
    });
    writeTransaction(paths, {
      ...transaction,
      phase: "complete",
      services: "running",
    });
    await enable();
    return { rebuilt: true, revision: prepared.revision, source: finalSource };
  } catch (error) {
    let stopped = false;
    try {
      await stop();
      stopped = true;
    } catch {
      /* receipt records uncertainty */
    }
    writeTransaction(paths, {
      ...transaction,
      phase: "failed-stopped",
      services: stopped ? "stopped" : "stop-unconfirmed",
      error_code: "rebuild_failed",
      error_message: error instanceof Error ? error.message : "Rebuild failed.",
    });
    throw error;
  }
}

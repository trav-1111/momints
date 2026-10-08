throw new Error(
  'Disabled after promotion: momints-roll-worker-staging is now the production target. ' +
    'This helper must never restore the disposable staging signer. Provision a new isolated sandbox and guarded helper instead.',
)

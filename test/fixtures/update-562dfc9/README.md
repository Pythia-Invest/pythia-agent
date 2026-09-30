# Historical updater regression

`apply-operation.mjs` is the unmodified public updater source from commit
`562dfc9f63c06bb1d377f6fdd49367d1c38af747`. The integration test executes this
shipped control flow with isolated synthetic installation paths, current support
modules and stubbed service/build actions. It reproduces the old updater stopping
services and advancing source before candidate migration checks. It does not
claim to reproduce a full Linux installation or dependency build.

No production configuration, credentials or research are included.

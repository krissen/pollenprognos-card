# Governance

## Maintainer

Pollenprognos Card is maintained by Kristian Niemi
([@krissen](https://github.com/krissen)). The maintainer has final say on
scope, code review, merges, releases and security handling.

## Contributions

Anyone is welcome to contribute through issues and pull requests, as described
in [CONTRIBUTING.md](CONTRIBUTING.md). Pull requests target `dev`, not
`master`, and carry at least one label. A change is merged when the maintainer
has reviewed it and CI passes: lint and formatting, type checking, the test
suite, the production build and HACS validation.

## Decisions

Proposals and disagreements are discussed openly in issues and pull requests.
The maintainer makes the final decision and records the reasoning there.

## Releases

Releases are cut by the maintainer: `dev` is merged into `master` through a
pull request, and a GitHub release is published with release notes. CI builds
and attaches the card bundle. Larger changes go out as a pre-release (beta)
first.

## Security

Vulnerabilities are reported and handled privately, as described in
[SECURITY.md](SECURITY.md).

## Changes to this document

If regular contributors emerge, the maintainer may invite co-maintainers.
Changes to governance are made through a pull request that updates this file.

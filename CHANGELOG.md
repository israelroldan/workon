# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## [3.5.1](https://github.com/israelroldan/workon/compare/v3.5.0...v3.5.1) (2026-02-18)


### Bug Fixes

* resolve project path handling bugs in add and relativize logic ([#33](https://github.com/israelroldan/workon/issues/33)) ([937eee6](https://github.com/israelroldan/workon/commit/937eee6bb4b7f53bb1f9380db72b64502dc09454))

## [3.5.0](https://github.com/israelroldan/workon/compare/v3.4.0...v3.5.0) (2026-02-05)


### Features

* store worktrees in global ~/.workon/worktrees directory ([#31](https://github.com/israelroldan/workon/issues/31)) ([f03f91b](https://github.com/israelroldan/workon/commit/f03f91be82113ccdb554f3463f7911258013e916))

## [3.4.0](https://github.com/israelroldan/workon/compare/v3.3.0...v3.4.0) (2026-02-04)


### Features

* simplify worktrees command to detect project from CWD ([#28](https://github.com/israelroldan/workon/issues/28)) ([31703c8](https://github.com/israelroldan/workon/commit/31703c82818efe5a1772146a3e9fc2f29a4900dd))

## [3.3.0](https://github.com/israelroldan/workon/compare/v3.2.4...v3.3.0) (2026-02-03)


### Features

* add git worktree management commands ([#26](https://github.com/israelroldan/workon/issues/26)) ([4268296](https://github.com/israelroldan/workon/commit/4268296c13809ba9fa87e47808c533a1e63e3b51))

## [3.2.4](https://github.com/israelroldan/workon/compare/v3.2.3...v3.2.4) (2026-01-13)


### Bug Fixes

* return to shell when tmux pane process exits ([#24](https://github.com/israelroldan/workon/issues/24)) ([0c07efc](https://github.com/israelroldan/workon/commit/0c07efc2a471e6155835a209e7ebf5ebb34f0e07))

## [3.2.3](https://github.com/israelroldan/workon/compare/v3.2.2...v3.2.3) (2026-01-10)


### Bug Fixes

* prevent config from being cleared by race conditions and tests ([#22](https://github.com/israelroldan/workon/issues/22)) ([520da78](https://github.com/israelroldan/workon/commit/520da78f3683518a46492967f9ad963a635bf006))

## [3.2.2](https://github.com/israelroldan/workon/compare/v3.2.1...v3.2.2) (2026-01-10)


### Bug Fixes

* improve shell mode and tmux -CC integration ([#20](https://github.com/israelroldan/workon/issues/20)) ([f9381e6](https://github.com/israelroldan/workon/commit/f9381e60e1ccdab1e60ee9bbb66c7f65bf6a8dc9))

## [3.2.1](https://github.com/israelroldan/workon/compare/v3.2.0...v3.2.1) (2026-01-10)


### Bug Fixes

* improve error handling in environment and event processing ([#16](https://github.com/israelroldan/workon/issues/16)) ([ddcf694](https://github.com/israelroldan/workon/commit/ddcf69409e8c6f791705b6853c1b3a8022f71df9))

## [3.2.0](https://github.com/israelroldan/workon/compare/v3.1.0...v3.2.0) (2026-01-10)


### Features

* add comprehensive test infrastructure and coverage ([#9](https://github.com/israelroldan/workon/issues/9)) ([2067d3f](https://github.com/israelroldan/workon/commit/2067d3f36dba870ec9d6ebe95a34b8cb2ae350ad))


### Bug Fixes

* add CLI project argument support and implement interactive features ([#11](https://github.com/israelroldan/workon/issues/11)) ([f16de59](https://github.com/israelroldan/workon/commit/f16de591db11bf01c0030f74df5faaf781e4ce72))

## [3.1.0](https://github.com/israelroldan/workon/compare/v3.0.0...v3.1.0) (2026-01-08)


### Features

* add `workon add` command for quick project registration ([#5](https://github.com/israelroldan/workon/issues/5)) ([2db3200](https://github.com/israelroldan/workon/commit/2db3200e2bdcfad5d5ed014d7747b4b6567f1a8d)), closes [#3](https://github.com/israelroldan/workon/issues/3)

## [3.0.0](https://github.com/israelroldan/workon/compare/v2.1.3...v3.0.0) (2026-01-08)


### ⚠ BREAKING CHANGES

* Complete rewrite from JavaScript to TypeScript.
    - Requires Node.js >= 20
    - Switched from npm to pnpm
    - CLI framework changed from switchit to Commander.js
    - Prompts library changed from inquirer to @inquirer/prompts

### Features

* Add split terminal support for 'claude' event (tmux based) ([c700afc](https://github.com/israelroldan/workon/commit/c700afc636ad04cf3b9dafa1e6553617929082be))
* Enhance 'claude' event configuration and validation ([12387e4](https://github.com/israelroldan/workon/commit/12387e489ff6832fd90dac82cee338a2dc48e215))
* Integrate NPM command support and enhance terminal layouts ([f877ec4](https://github.com/israelroldan/workon/commit/f877ec457e213bc9431cde3a01415a0b9af27c3f))
* Introduce colon syntax for selective command execution ([7b2193a](https://github.com/israelroldan/workon/commit/7b2193ace8cc014dfd71894e3e9f49e0fdea33b9))
* Migrate to TypeScript with modern tooling ([#1](https://github.com/israelroldan/workon/issues/1)) ([3079aba](https://github.com/israelroldan/workon/commit/3079aba12637414521aba06afea69e4b0505bd44))
* Refactor to Command-Centric Architecture and enhance command management ([b7f8478](https://github.com/israelroldan/workon/commit/b7f84789e677222af34ae2018b7eb452dd054e34))


### Bug Fixes

* Ensure tmux sessions spawn detached to avoid blocking ([5a98684](https://github.com/israelroldan/workon/commit/5a98684f535efac50cec1af011086adc957edd74))
* Update tmux attach command to use -CC flag for compatibility with iTerm ([2d3d7c7](https://github.com/israelroldan/workon/commit/2d3d7c73fb164f1718908d276f91b8fba004f42d))

### [2.1.3](https://github.com/israelroldan/workon/compare/v2.1.2...v2.1.3) (2025-08-07)


### Bug Fixes

* Ensure tmux sessions spawn detached to avoid blocking ([5a98684](https://github.com/israelroldan/workon/commit/5a98684f535efac50cec1af011086adc957edd74))

### [2.1.2](https://github.com/israelroldan/workon/compare/v2.1.1...v2.1.2) (2025-08-07)

### [2.1.1](https://github.com/israelroldan/workon/compare/v2.1.0...v2.1.1) (2025-08-07)


### Bug Fixes

* Update tmux attach command to use -CC flag for compatibility with iTerm ([2d3d7c7](https://github.com/israelroldan/workon/commit/2d3d7c73fb164f1718908d276f91b8fba004f42d))

## [2.1.0](https://github.com/israelroldan/workon/compare/v2.0.0...v2.1.0) (2025-08-07)


### Features

* Introduce colon syntax for selective command execution ([7b2193a](https://github.com/israelroldan/workon/commit/7b2193ace8cc014dfd71894e3e9f49e0fdea33b9))

## [2.0.0](https://github.com/israelroldan/workon/compare/v2.0.0-alpha.1...v2.0.0) (2025-08-07)

## [2.0.0-alpha.1](https://github.com/israelroldan/workon/compare/v1.4.1...v2.0.0-alpha.1) (2025-08-07)


### Features

* Refactor to Command-Centric Architecture and enhance command management ([b7f8478](https://github.com/israelroldan/workon/commit/b7f84789e677222af34ae2018b7eb452dd054e34))

<a name="1.4.1"></a>
## [1.4.1](https://github.com/israelroldan/workon/compare/v1.4.0...v1.4.1) (2025-08-07)



<a name="1.4.0"></a>
# [1.4.0](https://github.com/israelroldan/workon/compare/v1.3.0...v1.4.0) (2025-08-06)


### Features

* Integrate NPM command support and enhance terminal layouts ([f877ec4](https://github.com/israelroldan/workon/commit/f877ec4))



<a name="1.3.0"></a>
# [1.3.0](https://github.com/israelroldan/workon/compare/v1.2.1...v1.3.0) (2025-08-06)


### Features

* Add split terminal support for 'claude' event (tmux based) ([c700afc](https://github.com/israelroldan/workon/commit/c700afc))
* Enhance 'claude' event configuration and validation ([12387e4](https://github.com/israelroldan/workon/commit/12387e4))



<a name="1.2.1"></a>
## [1.2.1](https://github.com/israelroldan/workon/compare/v1.2.0...v1.2.1) (2025-08-06)


### Bug Fixes

* Adjust 'claude' command execution in shell mode ([c1bc5dc](https://github.com/israelroldan/workon/commit/c1bc5dc))



<a name="1.2.0"></a>
# [1.2.0](https://github.com/israelroldan/workon/compare/v1.1.0...v1.2.0) (2025-08-06)


### Features

* Introduce interactive project management feature ([3157e27](https://github.com/israelroldan/workon/commit/3157e27))



<a name="1.1.0"></a>
# [1.1.0](https://github.com/israelroldan/workon/compare/v1.0.0...v1.1.0) (2025-08-06)


### Bug Fixes

* Update package.json format for npm publish ([6c5e9e0](https://github.com/israelroldan/workon/commit/6c5e9e0))


### Features

* Enhance CLI with new 'claude' command support ([70b3f96](https://github.com/israelroldan/workon/commit/70b3f96))
* Improve shell integration for workon command ([f5b6ff0](https://github.com/israelroldan/workon/commit/f5b6ff0))



<a name="1.0.0-alpha.1"></a>
# [1.0.0-alpha.1](https://code.palu.io/israel/workon/compare/v1.0.0-alpha.0...v1.0.0-alpha.1) (2017-06-26)



<a name="1.0.0-alpha.0"></a>
# 1.0.0-alpha.0 (2017-06-26)


### Features

* **Miscelaneous:** Initial commit 🎉  ✨  😎 ([47ab926](https://code.palu.io/israel/workon/commits/47ab926))

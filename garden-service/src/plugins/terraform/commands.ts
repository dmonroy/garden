/*
 * Copyright (C) 2018-2020 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import chalk from "chalk"
import { terraform } from "./cli"
import { TerraformProvider } from "./terraform"
import { ConfigurationError, ParameterError } from "../../exceptions"
import { prepareVariables } from "./common"
import { Module } from "../../types/module"
import { findByName } from "../../util/util"
import { TerraformModule } from "./module"
import { PluginCommand } from "../../types/plugin/command"
import { join } from "path"

const commandsToWrap = ["apply", "plan"]

export const terraformCommands: PluginCommand[] = commandsToWrap.flatMap((commandName) => [
  makeRootCommand(commandName),
  makeModuleCommand(commandName),
])

function makeRootCommand(commandName: string) {
  const terraformCommand = chalk.bold("terraform " + commandName)

  return {
    name: commandName + "-root",
    description: `Runs ${terraformCommand} for the provider root stack, with the provider variables automatically configured as inputs. Positional arguments are passed to the command.`,
    title: chalk.bold.magenta(`Running ${chalk.white.bold(terraformCommand)} for project root stack`),
    async handler({ ctx, args, log }) {
      const provider = ctx.provider as TerraformProvider

      if (!provider.config.initRoot) {
        throw new ConfigurationError(`terraform provider does not have an ${chalk.underline("initRoot")} configured`, {
          config: provider.config,
        })
      }

      const tfRoot = join(ctx.projectRoot, provider.config.initRoot)

      args = [commandName, ...(await prepareVariables(tfRoot, provider.config.variables)), ...args]
      await terraform(provider.config.version).spawnAndWait({ log, args, cwd: tfRoot, tty: true })

      return { result: {} }
    },
  }
}

function makeModuleCommand(commandName: string) {
  const terraformCommand = chalk.bold("terraform " + commandName)

  return {
    name: commandName + "-module",
    description: `Runs ${terraformCommand} for the specified module, with the module variables automatically configured as inputs. Use the module name as first argument, followed by any arguments you want to pass to the command.`,
    resolveModules: true,

    title: ({ args }) =>
      chalk.bold.magenta(`Running ${chalk.white.bold(terraformCommand)} for module ${chalk.white.bold(args[0] || "")}`),

    async handler({ args, log, modules }) {
      const module = findModule(modules, args[0])

      const root = join(module.path, module.spec.root)
      args = [commandName, ...(await prepareVariables(root, module.spec.variables)), ...args.slice(1)]
      await terraform(module.spec.version).spawnAndWait({ log, args, cwd: root, tty: true })

      return { result: {} }
    },
  }
}

function findModule(modules: Module[], name: string): TerraformModule {
  if (!name) {
    throw new ParameterError(`The first command argument must be a module name.`, { name })
  }

  const module = findByName(modules, name)

  if (!module) {
    throw new ParameterError(chalk.red(`Could not find module ${chalk.white(name)}.`), {})
  }

  if (!module.compatibleTypes.includes("terraform")) {
    throw new ParameterError(chalk.red(`Module ${chalk.white(name)} is not a terraform module.`), {
      name,
      type: module.type,
      compatibleTypes: module.compatibleTypes,
    })
  }

  return module
}

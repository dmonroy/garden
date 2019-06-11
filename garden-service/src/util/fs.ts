/*
 * Copyright (C) 2018 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import klaw = require("klaw")
import * as _spawn from "cross-spawn"
import { pathExists, readFile } from "fs-extra"
import minimatch = require("minimatch")
import { some } from "lodash"
import { join, basename, win32, posix, relative, parse } from "path"
import { CONFIG_FILENAME } from "../constants"
// NOTE: Importing from ignore/ignore doesn't work on Windows
const ignore = require("ignore")

/*
  Warning: Don't make any async calls in the loop body when using this function, since this may cause
  funky concurrency behavior.
  */
export async function* scanDirectory(path: string, opts?: klaw.Options): AsyncIterableIterator<klaw.Item> {
  let done = false
  let resolver
  let rejecter

  klaw(path, opts)
    .on("data", (item) => {
      if (item.path !== path) {
        resolver(item)
      }
    })
    .on("error", (err) => {
      rejecter(err)
    })
    .on("end", () => {
      done = true
      resolver()
    })

  // a nice little trick to turn the stream into an async generator
  while (!done) {
    const promise: Promise<klaw.Item> = new Promise((resolve, reject) => {
      resolver = resolve
      rejecter = reject
    })

    yield await promise
  }
}

export async function getChildDirNames(parentDir: string): Promise<string[]> {
  let dirNames: string[] = []
  // Filter on hidden dirs by default. We could make the filter function a param if needed later
  const filter = (item: string) => !basename(item).startsWith(".")

  for await (const item of scanDirectory(parentDir, { depthLimit: 0, filter })) {
    if (!item || !item.stats.isDirectory()) {
      continue
    }
    dirNames.push(basename(item.path))
  }
  return dirNames
}

export interface Ignorer {
  ignores: (path: string) => boolean
}

export async function getIgnorer(rootPath: string, gardenDirPath: string): Promise<Ignorer> {
  // TODO: this doesn't handle nested .gitignore files, we should revisit
  const gitignorePath = join(rootPath, ".gitignore")
  const gardenignorePath = join(rootPath, ".gardenignore")
  const gardenDirRelPath = relative(rootPath, gardenDirPath)
  const ig = ignore()

  if (await pathExists(gitignorePath)) {
    ig.add((await readFile(gitignorePath)).toString())
  }

  if (await pathExists(gardenignorePath)) {
    ig.add((await readFile(gardenignorePath)).toString())
  }

  // should we be adding this (or more) by default?
  ig.add([
    "node_modules",
    ".git",
    "*.log",
    gardenDirRelPath,
    // TODO Take a better look at the temp files mutagen creates
    ".mutagen-*",
    // debug info folders and zip files generated by garden
    "debug-info-*",
  ])

  return ig
}

/**
 * Given a path returns an array of module paths for the project.
 *
 * @export
 * @param {string} dir Root of the project
 * @returns
 */
export async function getModulesPathsFromPath(dir: string, gardenDirPath: string) {
  const ignorer = await getIgnorer(dir, gardenDirPath)
  const scanOpts = {
    filter: (path) => {
      const relPath = relative(dir, path)
      return !ignorer.ignores(relPath)
    },
  }
  const paths: string[] = []

  for await (const item of scanDirectory(dir, scanOpts)) {
    if (!item) {
      continue
    }

    const parsedPath = parse(item.path)

    if (parsedPath.base !== CONFIG_FILENAME) {
      continue
    }

    paths.push(parsedPath.dir)
  }

  return paths
}

/**
 * Converts a Windows-style path to a cygwin style path (e.g. C:\some\folder -> /cygdrive/c/some/folder).
 */
export function toCygwinPath(path: string) {
  const parsed = win32.parse(path)
  const drive = parsed.root.split(":")[0].toLowerCase()
  const dirs = parsed.dir.split(win32.sep).slice(1)
  const cygpath = posix.join("/cygdrive", drive, ...dirs, parsed.base)

  // make sure trailing slash is retained
  return path.endsWith(win32.sep) ? cygpath + posix.sep : cygpath
}

/**
 * Checks if the given `path` matches any of the given glob `patterns`.
 */
export function matchGlobs(path: string, patterns: string[]): boolean {
  return some(patterns, pattern => minimatch(path, pattern))
}

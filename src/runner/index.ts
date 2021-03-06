import { Stack, Step, MessageStep, CommandStep } from "../parser";
import shell from "shelljs";
import fs from "fs-extra";
import cmdExists from "command-exists";
import logger from "../logger";
import Log from "tslog";
import { CWD } from "../constants";

interface RunnerOptions {
  overwrite?: boolean;
  logLevel?: Log.ILogLevel;
  start?: boolean;
}
export default class Runner {
  private stack: Stack;
  private workingDir: string;
  private options: RunnerOptions;

  constructor(stack: Stack, path: string, options?: RunnerOptions) {
    this.stack = stack;
    this.workingDir = path;
    this.options = options ?? {};
    logger.setSettings({
      minLevel: (this.options.logLevel as any) ?? "info",
    });
  }

  async run(): Promise<void> {
    logger.debug("Runner:run");
    await this.checkRequires();
    await this.createWorkingDir();
    try {
      await this.install();
      await this.postinstall();
      if (this.options.start) {
        await this.start();
      }
    } catch (e) {
      this.cleanUp();
      throw e;
    }
  }

  async install(): Promise<void> {
    logger.silly("Parser:install");
    const steps = this.convertCommands(this.stack.install);

    Promise.all(steps.map(this.executeStep.bind(this)));
  }

  async start(): Promise<void> {
    logger.silly("Parser:start");
    const steps = this.convertCommands(this.stack.start);

    if (!steps) return;

    Promise.all(steps.map(this.executeStep.bind(this)));
  }

  async postinstall(): Promise<void> {
    logger.silly("Parser:postinstall");
    const steps = this.convertCommands(this.stack.postinstall);

    if (!steps) return;

    Promise.all(steps.map(this.executeStep.bind(this)));
  }

  convertCommands(steps: Step[]): CommandStep[] {
    logger.debug("Parser:convertCommands");
    function convert(step: Step) {
      if (typeof step === "string") {
        return {
          cmd: step,
        };
      }
      if (step.hasOwnProperty("message")) {
        return {
          cmd: `echo ${(step as MessageStep).message}`,
        };
      }
      return step as CommandStep;
    }

    if (!steps) return steps;

    return steps.map(convert);
  }

  async checkRequires(): Promise<void> {
    logger.debug("checkRequires");
    for (const tool of this.stack.requires) {
      logger.debug(`Checking if ${tool} is installed`);

      if (await cmdExists(tool)) {
        logger.debug(`Success: ${tool} exists`);
      } else {
        logger.error(`${tool} not installed, cannot continue`);
        throw new Error(`Please install ${tool} to continue`);
      }
    }
  }

  async createWorkingDir(): Promise<void> {
    const pathExists = await fs.pathExists(this.workingDir);

    if (pathExists) {
      if (!this.options.overwrite) {
        logger.error(`Specified path already exists`);
        throw new Error("Specified path already exists");
      } else {
        logger.debug("Deleting working directory since --overwrite is enabled");
        shell.rm("-rf", this.workingDir);
      }
    }

    const status = shell.mkdir("-p", this.workingDir);
    if (status.code !== 0) {
      logger.error("Failed to create specified path");
      throw new Error("Failed to create path");
    }
  }

  async executeStep(step: CommandStep): Promise<void> {
    console.log(this.workingDir);
    const cdStatus = shell.cd(this.workingDir);
    if (cdStatus.code !== 0) {
      throw new Error(`Failed to cd into ${this.workingDir}`);
    }
    const status = shell.exec(step.cmd);

    if (status.code !== 0) {
      logger.error(`Failed to execute step`);
      logger.error(step.cmd);
      logger.error(`Failed with code ${status.code}`);
      throw new Error(`Failed to execute command`);
    }
  }

  cleanUp() {
    logger.silly("Runner:cleanUp");
    shell.cd(CWD);
    shell.rm("-rf", this.workingDir);
    logger.info("Cleaned up working directory");
  }
}

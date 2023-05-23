/*
 * Copyright 2021 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { InputError } from '@backstage/errors';
import {
  getBitbucketServerRequestOptions,
  ScmIntegrationRegistry,
} from '@backstage/integration';
import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import fetch, { RequestInit, Response } from 'node-fetch';
import { parseRepoUrl } from './util';
import { Config } from '@backstage/config';

const createPullRequest = async (opts: {
  project: string;
  repo: string;
  title: string;
  description?: string;
  toRef: object;
  fromRef: object;
  authorization: string;
  apiBaseUrl: string;
}) => {
  const {
    project,
    repo,
    title,
    description,
    toRef,
    fromRef,
    authorization,
    apiBaseUrl,
  } = opts;

  let response: Response;
  const data: RequestInit = {
    method: 'POST',
    body: JSON.stringify({
      title: title,
      description: description,
      state: 'OPEN',
      open: true,
      closed: false,
      locked: true,
      toRef: toRef,
      fromRef: fromRef,
    }),
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json',
    },
  };

  try {
    response = await fetch(
      `${apiBaseUrl}/projects/${project}/repos/${repo}/pull-requests`,
      data,
    );
  } catch (e) {
    throw new Error(`Unable to create pull-reqeusts, ${e}`);
  }

  if (response.status !== 201) {
    throw new Error(
      `Unable to create pull requests, ${response.status} ${
        response.statusText
      }, ${await response.text()}`,
    );
  }

  const r = await response.json();
  return `${r.links.self[0].href}`;
};
const findBranches = async (opts: {
  project: string;
  repo: string;
  branchName: string;
  authorization: string;
  apiBaseUrl: string;
}) => {
  const { project, repo, branchName, authorization, apiBaseUrl } = opts;

  let response: Response;
  const options: RequestInit = {
    method: 'GET',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json',
    },
  };

  try {
    response = await fetch(
      `${apiBaseUrl}/projects/${project}/repos/${repo}/branches?boostMatches=true&filterText=${branchName}`,
      options,
    );
  } catch (e) {
    throw new Error(`Unable to get branches, ${e}`);
  }

  if (response.status !== 200) {
    throw new Error(
      `Unable to get branches, ${response.status} ${
        response.statusText
      }, ${await response.text()}`,
    );
  }

  const r = await response.json();
  let branch;
  for (const object of r.values) {
    if (object.displayId === branchName) {
      branch = object;
      break;
    }
  }

  return branch;
};

/**
 * Creates a BitbucketServer Pull Request action.
 * @public
 */
export function createPublishBitbucketServerPullRequestAction(options: {
  integrations: ScmIntegrationRegistry;
  config: Config;
}) {
  const { integrations } = options;

  return createTemplateAction<{
    repoUrl: string;
    title: string;
    description?: string;
    targetBranch: string;
    sourceBranch: string;
    token?: string;
  }>({
    id: 'publish:bitbucketServer:pull-request',
    schema: {
      input: {
        type: 'object',
        required: ['repoUrl'],
        properties: {
          repoUrl: {
            title: 'Repository Location',
            type: 'string',
          },
          title: {
            title: 'Pull Request Name',
            type: 'string',
            description: 'The name for the pull request',
          },
          description: {
            title: 'Pull Request Description',
            type: 'string',
            description: 'The description of the pull request',
          },
          targetBranch: {
            title: 'Target Branch',
            type: 'string',
            description: 'The description of the pull request',
          },
          sourceBranch: {
            title: 'Source Branch',
            type: 'string',
            description: 'The description of the pull request',
          },
          token: {
            title: 'Authentication Token',
            type: 'string',
            description:
              'The token to use for authorization to BitBucket Server',
          },
        },
      },
      output: {
        type: 'object',
        properties: {
          pullRequestUrl: {
            title: 'A URL to the pull request with the provider',
            type: 'string',
          },
        },
      },
    },
    async handler(ctx) {
      const { repoUrl, title, description, targetBranch, sourceBranch } =
        ctx.input;

      const { project, repo, host } = parseRepoUrl(repoUrl, integrations);

      if (!project) {
        throw new InputError(
          `Invalid URL provider was included in the repo URL to create ${ctx.input.repoUrl}, missing project`,
        );
      }

      const integrationConfig = integrations.bitbucketServer.byHost(host);
      if (!integrationConfig) {
        throw new InputError(
          `No matching integration configuration for host ${host}, please check your integrations config`,
        );
      }

      const token = ctx.input.token ?? integrationConfig.config.token;

      const authConfig = {
        ...integrationConfig.config,
        ...{ token },
      };

      const reqOpts = getBitbucketServerRequestOptions(authConfig);
      const authorization = reqOpts.headers.Authorization;
      if (!authorization) {
        throw new Error(
          `Authorization has not been provided for ${integrationConfig.config.host}. Please add either (a) a user login auth token, or (b) a token or (c) username + password to the integration config.`,
        );
      }

      const apiBaseUrl = integrationConfig.config.apiBaseUrl;

      const toRef = await findBranches({
        project,
        repo,
        branchName: targetBranch,
        authorization,
        apiBaseUrl,
      });

      const fromRef = await findBranches({
        project,
        repo,
        branchName: sourceBranch,
        authorization,
        apiBaseUrl,
      });

      const pullRequestUrl = await createPullRequest({
        project,
        repo,
        title,
        description,
        toRef,
        fromRef,
        authorization,
        apiBaseUrl,
      });

      ctx.output('pullRequestUrl', pullRequestUrl);
    },
  });
}

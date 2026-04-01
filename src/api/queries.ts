export const QUERY_WORKSPACES = `
  query {
    me {
      workspaces {
        id
        name
        projects(first: 500) {
          edges {
            node {
              id
              name
              createdAt
              updatedAt
            }
          }
        }
      }
    }
  }
`;

export const QUERY_PROJECT_DETAIL = `
  query project($id: String!) {
    project(id: $id) {
      id
      name
      services {
        edges {
          node {
            id
            name
          }
        }
      }
      environments {
        edges {
          node {
            id
            name
          }
        }
      }
    }
  }
`;

export const QUERY_LATEST_DEPLOYMENT = `
  query deployments($input: DeploymentListInput!) {
    deployments(input: $input, first: 1) {
      edges {
        node {
          id
          status
          createdAt
        }
      }
    }
  }
`;

export const MUTATION_DEPLOYMENT_REDEPLOY = `
  mutation deploymentRedeploy($id: String!) {
    deploymentRedeploy(id: $id) {
      id
      status
    }
  }
`;

export const MUTATION_DEPLOYMENT_RESTART = `
  mutation deploymentRestart($id: String!) {
    deploymentRestart(id: $id)
  }
`;

export const QUERY_BUILD_LOGS = `
  query buildLogs($deploymentId: String!, $limit: Int) {
    buildLogs(deploymentId: $deploymentId, limit: $limit) {
      message
      timestamp
      severity
    }
  }
`;

export const QUERY_DEPLOY_LOGS = `
  query deploymentLogs($deploymentId: String!, $limit: Int) {
    deploymentLogs(deploymentId: $deploymentId, limit: $limit) {
      message
      timestamp
      severity
    }
  }
`;

export const QUERY_DEPLOYMENT_HISTORY = `
  query deployments($input: DeploymentListInput!) {
    deployments(input: $input, first: 10) {
      edges {
        node {
          id
          status
          createdAt
        }
      }
    }
  }
`;

export const QUERY_VARIABLES = `
  query variables($projectId: String!, $environmentId: String!, $serviceId: String!) {
    variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
  }
`;

export const MUTATION_VARIABLE_UPSERT = `
  mutation variableUpsert($input: VariableUpsertInput!) {
    variableUpsert(input: $input)
  }
`;

export const MUTATION_VARIABLE_DELETE = `
  mutation variableDelete($input: VariableDeleteInput!) {
    variableDelete(input: $input)
  }
`;

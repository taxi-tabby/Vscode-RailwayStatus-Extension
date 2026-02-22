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

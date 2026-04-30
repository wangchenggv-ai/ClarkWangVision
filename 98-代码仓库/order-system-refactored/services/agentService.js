// services/agentService.js
export async function findAgent(token) {
  // 模拟代理商数据
  if (token === 'test' || token.length > 10) {
    return {
      id: 'agent_001',
      name: '测试代理商',
      token: token
    };
  }
  return null;
}

export async function loadAgents() {
  return [
    { id: 'agent_001', name: '测试代理商' }
  ];
}
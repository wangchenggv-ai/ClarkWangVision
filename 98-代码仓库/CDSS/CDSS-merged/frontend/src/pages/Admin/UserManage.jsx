import { Card, Table, Typography, Tag } from 'antd'
import { UserOutlined } from '@ant-design/icons'

const { Title } = Typography

const ROLE_LABEL = { admin: '管理员', doctor: '医生', viewer: '只读' }
const ROLE_COLOR = { admin: 'red', doctor: 'blue', viewer: 'default' }

// Static mock data — real API would be implemented when backend is ready
const MOCK_USERS = [
  { id: 1, username: 'admin', full_name: '系统管理员', role: 'admin', email: 'admin@gaoshixing.com', is_active: true },
  { id: 2, username: 'doctor1', full_name: '张医生', role: 'doctor', email: 'doctor1@gaoshixing.com', is_active: true },
]

export default function UserManage() {
  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '用户名', dataIndex: 'username' },
    { title: '姓名', dataIndex: 'full_name', render: (v) => v || '-' },
    { title: '角色', dataIndex: 'role', render: (v) => <Tag color={ROLE_COLOR[v]}>{ROLE_LABEL[v] || v}</Tag> },
    { title: '邮箱', dataIndex: 'email' },
    { title: '状态', dataIndex: 'is_active', render: (v) => v ? '启用' : '停用', width: 80 },
  ]

  return (
    <div style={{ padding: 24 }}>
      <Title level={4} style={{ marginBottom: 16 }}>用户管理</Title>
      <Card>
        <Table rowKey="id" dataSource={MOCK_USERS} columns={columns} pagination={false} />
      </Card>
    </div>
  )
}

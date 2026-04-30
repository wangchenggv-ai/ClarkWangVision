import { useEffect, useState, useCallback } from 'react'
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import { PlusOutlined, EditOutlined } from '@ant-design/icons'
import { listUsers, createUser, updateUser } from '../../api/users'
import { listCenters } from '../../api/centers'

const { Title, Text } = Typography

const ROLE_OPTIONS = [
  { value: 'admin', label: '管理员' },
  { value: 'doctor', label: '医生' },
  { value: 'researcher', label: '研究员' },
]

const ROLE_TAG_COLOR = {
  admin: 'red',
  doctor: 'blue',
  researcher: 'green',
}

const ROLE_LABEL = {
  admin: '管理员',
  doctor: '医生',
  researcher: '研究员',
}

export default function UserManage() {
  const [users, setUsers] = useState([])
  const [centers, setCenters] = useState([])
  const [loading, setLoading] = useState(true)
  const [backendAvailable, setBackendAvailable] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingUser, setEditingUser] = useState(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [usersRes, centersRes] = await Promise.allSettled([
        listUsers(),
        listCenters(),
      ])

      if (usersRes.status === 'fulfilled') {
        const data = Array.isArray(usersRes.value.data)
          ? usersRes.value.data
          : usersRes.value.data?.items ?? []
        setUsers(data)
        setBackendAvailable(true)
      } else {
        const status = usersRes.reason?.response?.status
        if (status === 404 || status === undefined) {
          setBackendAvailable(false)
        } else {
          message.error('加载用户列表失败')
        }
      }

      if (centersRes.status === 'fulfilled') {
        const data = Array.isArray(centersRes.value.data)
          ? centersRes.value.data
          : centersRes.value.data?.items ?? []
        setCenters(data)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const openCreate = () => {
    setEditingUser(null)
    form.resetFields()
    setModalOpen(true)
  }

  const openEdit = (record) => {
    setEditingUser(record)
    form.setFieldsValue({
      username: record.username,
      email: record.email,
      full_name: record.full_name,
      role: record.role,
      center_id: record.center_id,
    })
    setModalOpen(true)
  }

  const handleModalOk = async () => {
    let values
    try {
      values = await form.validateFields()
    } catch {
      return
    }

    setSaving(true)
    try {
      if (editingUser) {
        // Don't send password on edit unless provided
        const payload = { ...values }
        if (!payload.password) delete payload.password
        await updateUser(editingUser.id, payload)
        message.success('用户信息已更新')
      } else {
        await createUser(values)
        message.success('用户创建成功')
      }
      setModalOpen(false)
      fetchData()
    } catch (err) {
      const status = err?.response?.status
      if (status === 404) {
        message.error('用户管理接口尚未实现（后端开发中）')
      } else {
        message.error(err?.response?.data?.detail || '操作失败，请重试')
      }
    } finally {
      setSaving(false)
    }
  }

  const centerName = (centerId) => {
    const c = centers.find((x) => x.id === centerId)
    return c ? c.name : centerId ?? '-'
  }

  const columns = [
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
    },
    {
      title: '姓名',
      dataIndex: 'full_name',
      key: 'full_name',
      render: (v) => v || '-',
    },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      render: (role) => (
        <Tag color={ROLE_TAG_COLOR[role] ?? 'default'}>
          {ROLE_LABEL[role] ?? role}
        </Tag>
      ),
    },
    {
      title: '所属中心',
      dataIndex: 'center_id',
      key: 'center_id',
      render: (id) => centerName(id),
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      key: 'is_active',
      render: (active) =>
        active !== false ? (
          <Tag color="success">启用</Tag>
        ) : (
          <Tag color="default">停用</Tag>
        ),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (v) => (v ? v.slice(0, 10) : '-'),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_, record) => (
        <Button
          type="link"
          icon={<EditOutlined />}
          onClick={() => openEdit(record)}
        >
          编辑
        </Button>
      ),
    },
  ]

  return (
    <div style={{ padding: '24px 16px' }}>
      <Space
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
        align="center"
      >
        <Title level={3} style={{ margin: 0 }}>
          用户管理
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新建用户
        </Button>
      </Space>

      <Alert
        type="info"
        showIcon
        message={
          <Text>
            用户账号由管理员统一创建，初始密码设置后由用户自行修改。
          </Text>
        }
        style={{ marginBottom: 20 }}
      />

      {!backendAvailable && (
        <Alert
          type="warning"
          showIcon
          message="用户管理接口暂未实现"
          description="后端 /api/users 路由正在开发中，用户列表功能将在后续版本上线。"
          style={{ marginBottom: 20 }}
        />
      )}

      <Table
        rowKey="id"
        dataSource={users}
        columns={columns}
        loading={loading}
        pagination={{ pageSize: 20, showSizeChanger: false }}
        locale={{ emptyText: backendAvailable ? '暂无用户数据' : '接口暂不可用' }}
      />

      {/* Create / Edit Modal */}
      <Modal
        title={editingUser ? '编辑用户' : '新建用户'}
        open={modalOpen}
        onOk={handleModalOk}
        onCancel={() => setModalOpen(false)}
        okText={editingUser ? '保存' : '创建'}
        cancelText="取消"
        confirmLoading={saving}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            label="用户名"
            name="username"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input placeholder="登录用用户名" disabled={!!editingUser} />
          </Form.Item>

          <Form.Item
            label="邮箱"
            name="email"
            rules={[
              { required: true, message: '请输入邮箱' },
              { type: 'email', message: '请输入有效邮箱地址' },
            ]}
          >
            <Input placeholder="user@example.com" />
          </Form.Item>

          <Form.Item label="姓名" name="full_name">
            <Input placeholder="真实姓名" />
          </Form.Item>

          {/* Password required on create, optional on edit */}
          <Form.Item
            label={editingUser ? '新密码（留空不修改）' : '初始密码'}
            name="password"
            rules={
              editingUser
                ? []
                : [{ required: true, message: '请设置初始密码' }]
            }
          >
            <Input.Password placeholder={editingUser ? '不修改请留空' : '请设置初始密码'} />
          </Form.Item>

          <Form.Item
            label="角色"
            name="role"
            rules={[{ required: true, message: '请选择角色' }]}
          >
            <Select placeholder="选择角色" options={ROLE_OPTIONS} />
          </Form.Item>

          <Form.Item label="所属中心" name="center_id">
            <Select
              placeholder="选择所属中心"
              allowClear
              options={centers.map((c) => ({ value: c.id, label: c.name }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

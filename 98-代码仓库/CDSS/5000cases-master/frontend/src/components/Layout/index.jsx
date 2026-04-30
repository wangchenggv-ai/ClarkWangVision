import { useState } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import {
  Layout,
  Menu,
  Avatar,
  Dropdown,
  Typography,
  Space,
  theme,
  Modal,
  Form,
  Input,
  message,
} from 'antd'
import {
  TeamOutlined,
  ClockCircleOutlined,
  DownloadOutlined,
  BankOutlined,
  UserOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  LogoutOutlined,
  KeyOutlined,
} from '@ant-design/icons'
import { useAuth } from '../../contexts/AuthContext'
import { changePassword } from '../../api/auth'

const { Sider, Header, Content } = Layout
const { Text } = Typography

// Build menu items, optionally including admin section
function buildMenuItems(isAdmin) {
  const items = [
    {
      key: '/patients',
      icon: <TeamOutlined />,
      label: '患者管理',
    },
    {
      key: '/overdue',
      icon: <ClockCircleOutlined />,
      label: '逾期随访',
    },
    {
      key: '/export',
      icon: <DownloadOutlined />,
      label: '数据导出',
    },
  ]

  if (isAdmin) {
    items.push(
      {
        type: 'divider',
      },
      {
        key: 'admin-group',
        label: '管理员',
        type: 'group',
        children: [
          {
            key: '/admin/centers',
            icon: <BankOutlined />,
            label: '中心管理',
          },
          {
            key: '/admin/users',
            icon: <UserOutlined />,
            label: '用户管理',
          },
        ],
      }
    )
  }

  return items
}

export default function AppLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  const [pwdModalOpen, setPwdModalOpen] = useState(false)
  const [pwdForm] = Form.useForm()
  const [pwdLoading, setPwdLoading] = useState(false)
  const { token } = theme.useToken()

  const isAdmin = user?.role === 'admin'
  const menuItems = buildMenuItems(isAdmin)

  // Derive selected key from pathname
  // For nested routes like /patients/123, still highlight /patients
  const selectedKey = (() => {
    const path = location.pathname
    if (path.startsWith('/admin/users')) return '/admin/users'
    if (path.startsWith('/admin/centers')) return '/admin/centers'
    if (path.startsWith('/patients')) return '/patients'
    if (path.startsWith('/overdue')) return '/overdue'
    if (path.startsWith('/export')) return '/export'
    return path
  })()

  const handleMenuClick = ({ key }) => {
    navigate(key)
  }

  const handleChangePassword = async (values) => {
    if (values.new_password !== values.confirm_password) {
      message.error('两次输入的新密码不一致')
      return
    }
    setPwdLoading(true)
    try {
      await changePassword({
        old_password: values.old_password,
        new_password: values.new_password,
      })
      message.success('密码修改成功，请重新登录')
      setPwdModalOpen(false)
      pwdForm.resetFields()
      logout()
    } catch (err) {
      const msg = err.response?.data?.detail || '密码修改失败'
      message.error(msg)
    } finally {
      setPwdLoading(false)
    }
  }

  const userMenuItems = [
    {
      key: 'change-password',
      icon: <KeyOutlined />,
      label: '修改密码',
      onClick: () => setPwdModalOpen(true),
    },
    {
      type: 'divider',
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      danger: true,
      onClick: logout,
    },
  ]

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        width={220}
        trigger={null}
        style={{
          background: token.colorBgContainer,
          borderRight: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        {/* Logo / Brand */}
        <div
          style={{
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            padding: collapsed ? 0 : '0 20px',
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            overflow: 'hidden',
            whiteSpace: 'nowrap',
          }}
        >
          <BankOutlined style={{ fontSize: 20, color: token.colorPrimary, flexShrink: 0 }} />
          {!collapsed && (
            <Text
              strong
              style={{
                marginLeft: 10,
                fontSize: 13,
                color: token.colorTextHeading,
                lineHeight: 1.3,
              }}
            >
              近视管理平台
            </Text>
          )}
        </div>

        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={handleMenuClick}
          style={{ borderRight: 0, marginTop: 8 }}
        />
      </Sider>

      <Layout>
        <Header
          style={{
            background: token.colorBgContainer,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          {/* Collapse toggle */}
          <Space>
            {collapsed ? (
              <MenuUnfoldOutlined
                onClick={() => setCollapsed(false)}
                style={{ fontSize: 18, cursor: 'pointer', color: token.colorTextSecondary }}
              />
            ) : (
              <MenuFoldOutlined
                onClick={() => setCollapsed(true)}
                style={{ fontSize: 18, cursor: 'pointer', color: token.colorTextSecondary }}
              />
            )}
            <Text strong style={{ fontSize: 16, marginLeft: 8 }}>
              近视离焦镜科研管理平台
            </Text>
          </Space>

          {/* User area */}
          <Dropdown menu={{ items: userMenuItems }} placement="bottomRight" arrow>
            <Space style={{ cursor: 'pointer' }}>
              <Avatar
                size="small"
                icon={<UserOutlined />}
                style={{ backgroundColor: token.colorPrimary }}
              />
              <Text>{user?.full_name || user?.username || '用户'}</Text>
            </Space>
          </Dropdown>
        </Header>

        <Content
          style={{
            margin: 24,
            padding: 24,
            background: token.colorBgContainer,
            borderRadius: token.borderRadiusLG,
            minHeight: 280,
          }}
        >
          <Outlet />
        </Content>
      </Layout>

      {/* Change Password Modal */}
      <Modal
        title="修改密码"
        open={pwdModalOpen}
        onOk={() => pwdForm.submit()}
        onCancel={() => {
          setPwdModalOpen(false)
          pwdForm.resetFields()
        }}
        confirmLoading={pwdLoading}
        okText="确认修改"
        cancelText="取消"
        destroyOnClose
      >
        <Form
          form={pwdForm}
          layout="vertical"
          onFinish={handleChangePassword}
          style={{ marginTop: 16 }}
        >
          <Form.Item
            label="当前密码"
            name="old_password"
            rules={[{ required: true, message: '请输入当前密码' }]}
          >
            <Input.Password placeholder="请输入当前密码" />
          </Form.Item>
          <Form.Item
            label="新密码"
            name="new_password"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 6, message: '密码至少6位' },
            ]}
          >
            <Input.Password placeholder="请输入新密码" />
          </Form.Item>
          <Form.Item
            label="确认新密码"
            name="confirm_password"
            rules={[{ required: true, message: '请再次输入新密码' }]}
          >
            <Input.Password placeholder="请再次输入新密码" />
          </Form.Item>
        </Form>
      </Modal>
    </Layout>
  )
}

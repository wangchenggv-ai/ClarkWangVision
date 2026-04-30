import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Form, Input, Button, Card, Typography, Alert, Space, theme } from 'antd'
import { UserOutlined, LockOutlined, EyeOutlined } from '@ant-design/icons'
import { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'

const { Title, Text } = Typography

export default function LoginPage() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const { token } = theme.useToken()

  // Redirect if already authenticated
  useEffect(() => {
    if (user) {
      navigate('/patients', { replace: true })
    }
  }, [user, navigate])

  const handleSubmit = async (values) => {
    setLoading(true)
    setError(null)
    try {
      await login(values.username, values.password)
      navigate('/patients', { replace: true })
    } catch (err) {
      const detail = err.response?.data?.detail
      if (typeof detail === 'string') {
        setError(detail)
      } else if (Array.isArray(detail)) {
        setError(detail.map((d) => d.msg).join('; '))
      } else {
        setError('用户名或密码错误，请重试')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: token.colorBgLayout,
        padding: 24,
      }}
    >
      <Card
        style={{
          width: '100%',
          maxWidth: 400,
          boxShadow: token.boxShadowSecondary,
          borderRadius: token.borderRadiusLG,
        }}
        styles={{ body: { padding: '40px 36px' } }}
      >
        {/* Logo / Brand header */}
        <Space
          direction="vertical"
          align="center"
          style={{ width: '100%', marginBottom: 32 }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: token.colorPrimaryBg,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <EyeOutlined style={{ fontSize: 28, color: token.colorPrimary }} />
          </div>
          <Title level={4} style={{ margin: 0, textAlign: 'center' }}>
            近视离焦镜科研管理平台
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            请登录以继续
          </Text>
        </Space>

        {error && (
          <Alert
            message={error}
            type="error"
            showIcon
            closable
            onClose={() => setError(null)}
            style={{ marginBottom: 20 }}
          />
        )}

        <Form
          name="login"
          layout="vertical"
          onFinish={handleSubmit}
          autoComplete="off"
          requiredMark={false}
        >
          <Form.Item
            label="用户名"
            name="username"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input
              prefix={<UserOutlined style={{ color: token.colorTextPlaceholder }} />}
              placeholder="请输入用户名"
              size="large"
              autoFocus
            />
          </Form.Item>

          <Form.Item
            label="密码"
            name="password"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: token.colorTextPlaceholder }} />}
              placeholder="请输入密码"
              size="large"
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0, marginTop: 8 }}>
            <Button
              type="primary"
              htmlType="submit"
              size="large"
              block
              loading={loading}
            >
              登录
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  )
}

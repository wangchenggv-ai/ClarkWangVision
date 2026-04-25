import { useState, useEffect } from 'react'
import { Card, Table, Button, Modal, Form, Input, Typography, message, Space } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { listCenters, createCenter } from '../../api/centers'

const { Title } = Typography

export default function CenterManage() {
  const [centers, setCenters] = useState([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)

  const fetchCenters = async () => {
    setLoading(true)
    try {
      const res = await listCenters()
      setCenters(Array.isArray(res.data) ? res.data : res.data?.items || [])
    } catch { /* ok */ }
    finally { setLoading(false) }
  }

  useEffect(() => { fetchCenters() }, [])

  const handleCreate = async (values) => {
    setSubmitting(true)
    try {
      await createCenter(values)
      message.success('中心创建成功')
      setModalOpen(false)
      form.resetFields()
      fetchCenters()
    } catch (err) {
      message.error(err.response?.data?.detail || '创建失败')
    } finally { setSubmitting(false) }
  }

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '中心名称', dataIndex: 'name' },
    { title: '城市', dataIndex: 'city', render: (v) => v || '-' },
    { title: '联系人', dataIndex: 'contact_name', render: (v) => v || '-' },
    { title: '联系电话', dataIndex: 'contact_phone', render: (v) => v || '-' },
    { title: '状态', dataIndex: 'is_active', render: (v) => v ? '启用' : '停用', width: 80 },
  ]

  return (
    <div style={{ padding: 24 }}>
      <Space style={{ marginBottom: 16, justifyContent: 'space-between', width: '100%' }}>
        <Title level={4} style={{ margin: 0 }}>中心管理</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>新建中心</Button>
      </Space>
      <Card>
        <Table rowKey="id" dataSource={centers} columns={columns} loading={loading} pagination={false} />
      </Card>
      <Modal title="新建中心" open={modalOpen} onOk={() => form.submit()} onCancel={() => { setModalOpen(false); form.resetFields() }} confirmLoading={submitting}>
        <Form form={form} layout="vertical" onFinish={handleCreate} style={{ marginTop: 16 }}>
          <Form.Item label="中心名称" name="name" rules={[{ required: true, message: '请输入中心名称' }]}>
            <Input placeholder="请输入中心名称" />
          </Form.Item>
          <Form.Item label="城市" name="city"><Input placeholder="请输入城市" /></Form.Item>
          <Form.Item label="联系人" name="contact_name"><Input placeholder="请输入联系人" /></Form.Item>
          <Form.Item label="联系电话" name="contact_phone"><Input placeholder="请输入联系电话" /></Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

import { useEffect, useState, useCallback } from 'react'
import {
  Button,
  Form,
  Input,
  Modal,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import { PlusOutlined, EditOutlined } from '@ant-design/icons'
import { listCenters, createCenter, updateCenter } from '../../api/centers'

const { Title } = Typography

export default function CenterManage() {
  const [centers, setCenters] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingCenter, setEditingCenter] = useState(null) // null = create mode
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  const fetchCenters = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listCenters()
      const data = Array.isArray(res.data) ? res.data : res.data?.items ?? []
      setCenters(data)
    } catch {
      message.error('加载中心列表失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchCenters()
  }, [fetchCenters])

  const openCreate = () => {
    setEditingCenter(null)
    form.resetFields()
    setModalOpen(true)
  }

  const openEdit = (record) => {
    setEditingCenter(record)
    form.setFieldsValue({
      name: record.name,
      city: record.city,
      contact_name: record.contact_name,
      contact_phone: record.contact_phone,
    })
    setModalOpen(true)
  }

  const handleModalOk = async () => {
    let values
    try {
      values = await form.validateFields()
    } catch {
      return // validation failed
    }

    setSaving(true)
    try {
      if (editingCenter) {
        await updateCenter(editingCenter.id, values)
        message.success('中心信息已更新')
      } else {
        await createCenter(values)
        message.success('中心创建成功')
      }
      setModalOpen(false)
      fetchCenters()
    } catch (err) {
      message.error(err?.response?.data?.detail || '操作失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  const columns = [
    {
      title: '中心名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '城市',
      dataIndex: 'city',
      key: 'city',
    },
    {
      title: '联系人',
      dataIndex: 'contact_name',
      key: 'contact_name',
      render: (v) => v || '-',
    },
    {
      title: '联系电话',
      dataIndex: 'contact_phone',
      key: 'contact_phone',
      render: (v) => v || '-',
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
        style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}
        align="center"
      >
        <Title level={3} style={{ margin: 0 }}>
          中心管理
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新建中心
        </Button>
      </Space>

      <Table
        rowKey="id"
        dataSource={centers}
        columns={columns}
        loading={loading}
        pagination={{ pageSize: 20, showSizeChanger: false }}
        locale={{ emptyText: '暂无中心数据' }}
      />

      {/* Create / Edit Modal */}
      <Modal
        title={editingCenter ? '编辑中心' : '新建中心'}
        open={modalOpen}
        onOk={handleModalOk}
        onCancel={() => setModalOpen(false)}
        okText={editingCenter ? '保存' : '创建'}
        cancelText="取消"
        confirmLoading={saving}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            label="中心名称"
            name="name"
            rules={[{ required: true, message: '请输入中心名称' }]}
          >
            <Input placeholder="例：北京协和医院眼科" />
          </Form.Item>

          <Form.Item
            label="城市"
            name="city"
            rules={[{ required: true, message: '请输入城市' }]}
          >
            <Input placeholder="例：北京" />
          </Form.Item>

          <Form.Item label="联系人" name="contact_name">
            <Input placeholder="负责人姓名" />
          </Form.Item>

          <Form.Item label="联系电话" name="contact_phone">
            <Input placeholder="联系电话" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

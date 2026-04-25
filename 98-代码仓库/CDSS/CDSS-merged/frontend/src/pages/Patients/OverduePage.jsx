import { useState, useEffect } from 'react'
import {
  Table,
  Typography,
  Card,
  Alert,
  Empty,
  Space,
} from 'antd'
import { WarningOutlined, FormOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import { getOverduePatients } from '../../api/patients'

const { Title, Text } = Typography

const OVERDUE_TYPE_LABEL = {
  '1M': '1个月随访',
  '3M': '3个月随访',
  '6M': '6个月随访',
  '12M': '12个月随访',
}

export default function OverduePage() {
  const [patients, setPatients] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    async function fetchOverdue() {
      setLoading(true)
      try {
        const res = await getOverduePatients()
        setPatients(res.data || [])
      } catch (err) {
        console.error('获取逾期患者失败', err)
      } finally {
        setLoading(false)
      }
    }

    fetchOverdue()
  }, [])

  const columns = [
    {
      title: '编号',
      dataIndex: 'patient_no',
      key: 'patient_no',
      width: 130,
    },
    {
      title: '姓名',
      dataIndex: 'name',
      key: 'name',
      render: (name, record) => (
        <Link to={`/patients/${record.id}`}>{name}</Link>
      ),
    },
    {
      title: '入组时间',
      dataIndex: 'enrolled_at',
      key: 'enrolled_at',
      width: 120,
      render: (val) => (val ? val.slice(0, 10) : '-'),
    },
    {
      title: '逾期随访类型',
      dataIndex: 'overdue_visit_type',
      key: 'overdue_visit_type',
      width: 150,
      render: (val) => {
        if (!val) return '-'
        if (Array.isArray(val)) {
          return (
            <Space wrap>
              {val.map((t) => (
                <Text key={t} type="danger">
                  {OVERDUE_TYPE_LABEL[t] || t}
                </Text>
              ))}
            </Space>
          )
        }
        return (
          <Text type="danger">{OVERDUE_TYPE_LABEL[val] || val}</Text>
        )
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_, record) => (
        <Link to={`/patients/${record.id}/visits/new`}>
          <FormOutlined /> 录入随访
        </Link>
      ),
    },
  ]

  return (
    <div style={{ padding: '24px' }}>
      <Title level={4} style={{ marginBottom: 8 }}>
        逾期随访患者
      </Title>

      <Alert
        type="warning"
        icon={<WarningOutlined />}
        showIcon
        message="以下患者的随访时间点已到期但尚未完成记录"
        style={{ marginBottom: 16 }}
      />

      <Card>
        <Table
          rowKey="id"
          dataSource={patients}
          columns={columns}
          loading={loading}
          pagination={{
            showTotal: (t) => `共 ${t} 条`,
            showSizeChanger: false,
          }}
          locale={{
            emptyText: (
              <Empty
                description="暂无逾期患者"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            ),
          }}
        />
      </Card>
    </div>
  )
}

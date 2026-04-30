import { useState, useEffect, useCallback } from 'react'
import {
  Table,
  Button,
  Input,
  Space,
  Tag,
  Typography,
  Row,
  Col,
  Card,
} from 'antd'
import {
  PlusOutlined,
  CheckOutlined,
  MinusOutlined,
  EyeOutlined,
} from '@ant-design/icons'
import { useNavigate, Link } from 'react-router-dom'
import { listPatients } from '../../api/patients'

const { Title } = Typography
const { Search } = Input

function useDebounce(value, delay) {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debouncedValue
}

export default function PatientList() {
  const navigate = useNavigate()

  const [patients, setPatients] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20 })

  const debouncedSearch = useDebounce(searchText, 300)

  const fetchPatients = useCallback(
    async (page, pageSize, search) => {
      setLoading(true)
      try {
        const res = await listPatients({
          page,
          page_size: pageSize,
          search: search || undefined,
        })
        const data = res.data
        setPatients(data.items || [])
        setTotal(data.total || 0)
      } catch (err) {
        console.error('获取患者列表失败', err)
      } finally {
        setLoading(false)
      }
    },
    []
  )

  useEffect(() => {
    fetchPatients(pagination.current, pagination.pageSize, debouncedSearch)
  }, [pagination.current, pagination.pageSize, debouncedSearch, fetchPatients])

  const handleTableChange = (pag) => {
    setPagination({ current: pag.current, pageSize: pag.pageSize })
  }

  const handleSearchChange = (e) => {
    setSearchText(e.target.value)
    setPagination((prev) => ({ ...prev, current: 1 }))
  }

  const columns = [
    {
      title: '编号',
      dataIndex: 'patient_no',
      key: 'patient_no',
      sorter: (a, b) =>
        (a.patient_no || '').localeCompare(b.patient_no || ''),
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
      title: '性别',
      dataIndex: 'gender',
      key: 'gender',
      width: 70,
      render: (gender) =>
        gender === 'male' ? (
          <Tag color="blue">男</Tag>
        ) : gender === 'female' ? (
          <Tag color="magenta">女</Tag>
        ) : (
          '-'
        ),
    },
    {
      title: '出生日期',
      dataIndex: 'birth_date',
      key: 'birth_date',
      width: 120,
      render: (val) => val || '-',
    },
    {
      title: '就读年级',
      dataIndex: 'school_grade',
      key: 'school_grade',
      width: 120,
      render: (val) => val || '-',
    },
    {
      title: '所属中心',
      key: 'center',
      width: 150,
      render: (_, record) =>
        record.center?.name || record.center_id || '-',
    },
    {
      title: '入组时间',
      dataIndex: 'enrolled_at',
      key: 'enrolled_at',
      width: 120,
      render: (val) => (val ? val.slice(0, 10) : '-'),
    },
    {
      title: '基线',
      dataIndex: 'has_baseline',
      key: 'has_baseline',
      width: 70,
      align: 'center',
      render: (val) =>
        val ? (
          <CheckOutlined style={{ color: '#52c41a' }} />
        ) : (
          <MinusOutlined style={{ color: '#bfbfbf' }} />
        ),
    },
    {
      title: '随访次数',
      dataIndex: 'follow_up_count',
      key: 'follow_up_count',
      width: 90,
      align: 'center',
      render: (val) => (val != null ? val : 0),
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      render: (_, record) => (
        <Space>
          <Link to={`/patients/${record.id}`}>
            <EyeOutlined /> 查看
          </Link>
        </Space>
      ),
    },
  ]

  return (
    <div style={{ padding: '24px' }}>
      <Row
        justify="space-between"
        align="middle"
        style={{ marginBottom: 16 }}
      >
        <Col>
          <Title level={4} style={{ margin: 0 }}>
            患者列表
          </Title>
        </Col>
        <Col>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => navigate('/patients/new')}
          >
            新建患者
          </Button>
        </Col>
      </Row>

      <Card style={{ marginBottom: 16 }}>
        <Search
          placeholder="按姓名或编号搜索"
          value={searchText}
          onChange={handleSearchChange}
          style={{ width: 300 }}
          allowClear
        />
      </Card>

      <Card>
        <Table
          rowKey="id"
          dataSource={patients}
          columns={columns}
          loading={loading}
          onChange={handleTableChange}
          pagination={{
            current: pagination.current,
            pageSize: pagination.pageSize,
            total,
            showTotal: (t) => `共 ${t} 条`,
            showSizeChanger: true,
            pageSizeOptions: ['10', '20', '50'],
          }}
          scroll={{ x: 950 }}
        />
      </Card>
    </div>
  )
}

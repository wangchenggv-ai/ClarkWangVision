import { useState, useEffect } from 'react'
import {
  Card,
  Button,
  Descriptions,
  Tag,
  Typography,
  Space,
  Row,
  Col,
  Table,
  Empty,
  Timeline,
  Spin,
  message,
} from 'antd'
import {
  ArrowLeftOutlined,
  EditOutlined,
  PlusOutlined,
} from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { getPatient } from '../../api/patients'
import { getBaseline } from '../../api/exams'
import { listVisits } from '../../api/visits'

const { Title, Text } = Typography

function calcAge(birthDateStr) {
  if (!birthDateStr) return null
  const birth = new Date(birthDateStr)
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
    age -= 1
  }
  return age
}

const GENDER_LABEL = { male: '男', female: '女' }
const PARENT_MYOPIA_LABEL = {
  none: '无',
  one: '一方近视',
  both: '父母均近视',
}
const VISIT_TYPE_LABEL = {
  '1M': '1个月',
  '3M': '3个月',
  '6M': '6个月',
  '12M': '12个月',
}

const BASELINE_ROWS = [
  { label: '球镜 (DS)', odKey: 'od_sphere', osKey: 'os_sphere' },
  { label: '柱镜 (DC)', odKey: 'od_cylinder', osKey: 'os_cylinder' },
  { label: '轴向 (Axis)', odKey: 'od_axis', osKey: 'os_axis' },
  { label: '视力 (VA)', odKey: 'od_va', osKey: 'os_va' },
  { label: '眼轴 (mm)', odKey: 'od_axial_length', osKey: 'os_axial_length' },
  { label: '角膜曲率 K1', odKey: 'od_k1', osKey: 'os_k1' },
  { label: '角膜曲率 K2', odKey: 'od_k2', osKey: 'os_k2' },
]

function BaselineTable({ baseline }) {
  const dataSource = BASELINE_ROWS.map((row) => ({
    key: row.label,
    metric: row.label,
    od: baseline[row.odKey] != null ? baseline[row.odKey] : '-',
    os: baseline[row.osKey] != null ? baseline[row.osKey] : '-',
  }))

  const columns = [
    { title: '指标', dataIndex: 'metric', key: 'metric', width: 160 },
    { title: '右眼 (OD)', dataIndex: 'od', key: 'od', align: 'center' },
    { title: '左眼 (OS)', dataIndex: 'os', key: 'os', align: 'center' },
  ]

  return (
    <Table
      dataSource={dataSource}
      columns={columns}
      pagination={false}
      size="small"
      bordered
      footer={() => (
        <Row gutter={32}>
          <Col>
            <Text type="secondary">镜片品牌：</Text>
            <Text>{baseline.lens_brand || '-'}</Text>
          </Col>
          <Col>
            <Text type="secondary">日均佩戴时长(h)：</Text>
            <Text>
              {baseline.wearing_hours != null ? baseline.wearing_hours : '-'}
            </Text>
          </Col>
        </Row>
      )}
    />
  )
}

function VisitTimeline({ visits, patientId, navigate }) {
  if (!visits || visits.length === 0) {
    return (
      <Empty description="暂无随访记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
    )
  }

  return (
    <Timeline
      items={visits.map((v) => ({
        key: v.id,
        children: (
          <Card
            size="small"
            style={{ marginBottom: 8 }}
            extra={
              <Button
                size="small"
                icon={<EditOutlined />}
                onClick={() =>
                  navigate(`/patients/${patientId}/visits/${v.id}/edit`)
                }
              >
                编辑
              </Button>
            }
            title={
              <Space>
                <Tag color="blue">
                  {VISIT_TYPE_LABEL[v.visit_type] || v.visit_type}
                </Tag>
                <Text type="secondary">
                  {v.visit_date ? v.visit_date.slice(0, 10) : '-'}
                </Text>
              </Space>
            }
          >
            <Row gutter={24}>
              <Col>
                <Text type="secondary">右眼眼轴变化：</Text>
                <Text>
                  {v.od_axial_length != null
                    ? `${v.od_axial_length} mm`
                    : '-'}
                </Text>
              </Col>
              <Col>
                <Text type="secondary">右眼球镜变化：</Text>
                <Text>
                  {v.od_sphere != null ? `${v.od_sphere} DS` : '-'}
                </Text>
              </Col>
              <Col>
                <Text type="secondary">佩戴时长：</Text>
                <Text>
                  {v.wearing_hours != null ? `${v.wearing_hours} h` : '-'}
                </Text>
              </Col>
            </Row>
          </Card>
        ),
      }))}
    />
  )
}

export default function PatientDetail() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [patient, setPatient] = useState(null)
  const [baseline, setBaseline] = useState(null)
  const [visits, setVisits] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchAll() {
      setLoading(true)
      try {
        const patientRes = await getPatient(id)
        const p = patientRes.data
        setPatient(p)

        if (p.has_baseline) {
          try {
            const bRes = await getBaseline(id)
            setBaseline(bRes.data)
          } catch {
            // baseline may not exist even if flag is set
          }
        }

        try {
          const vRes = await listVisits(id)
          setVisits(vRes.data || [])
        } catch {
          setVisits([])
        }
      } catch (err) {
        message.error('获取患者信息失败')
        console.error(err)
      } finally {
        setLoading(false)
      }
    }

    fetchAll()
  }, [id])

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '80px' }}>
        <Spin size="large" />
      </div>
    )
  }

  if (!patient) {
    return (
      <div style={{ padding: '24px' }}>
        <Empty description="患者不存在" />
      </div>
    )
  }

  const age = calcAge(patient.birth_date)

  return (
    <div style={{ padding: '24px' }}>
      {/* Page Header */}
      <Row
        justify="space-between"
        align="middle"
        style={{ marginBottom: 24 }}
      >
        <Col>
          <Space align="center">
            <Button
              icon={<ArrowLeftOutlined />}
              onClick={() => navigate('/patients')}
            >
              返回
            </Button>
            <Title level={4} style={{ margin: 0 }}>
              {patient.patient_no} — {patient.name}
            </Title>
          </Space>
        </Col>
        <Col>
          <Button
            type="primary"
            icon={<EditOutlined />}
            onClick={() => navigate(`/patients/${id}/edit`)}
          >
            编辑
          </Button>
        </Col>
      </Row>

      {/* 基本信息 */}
      <Card title="基本信息" style={{ marginBottom: 16 }}>
        <Descriptions column={2} bordered size="small">
          <Descriptions.Item label="姓名">{patient.name}</Descriptions.Item>
          <Descriptions.Item label="性别">
            {patient.gender === 'male' ? (
              <Tag color="blue">男</Tag>
            ) : patient.gender === 'female' ? (
              <Tag color="magenta">女</Tag>
            ) : (
              '-'
            )}
          </Descriptions.Item>
          <Descriptions.Item label="出生日期">
            {patient.birth_date || '-'}
            {age != null && (
              <Text type="secondary" style={{ marginLeft: 8 }}>
                ({age} 岁)
              </Text>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="就读年级">
            {patient.school_grade || '-'}
          </Descriptions.Item>
          <Descriptions.Item label="父母近视情况">
            {PARENT_MYOPIA_LABEL[patient.parent_myopia] ||
              patient.parent_myopia ||
              '-'}
          </Descriptions.Item>
          <Descriptions.Item label="日均户外时间">
            {patient.outdoor_hours_per_day != null
              ? `${patient.outdoor_hours_per_day} 小时`
              : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="日均近距用眼时间">
            {patient.near_work_hours_per_day != null
              ? `${patient.near_work_hours_per_day} 小时`
              : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="入组时间">
            {patient.enrolled_at ? patient.enrolled_at.slice(0, 10) : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="所属中心">
            {patient.center?.name || patient.center_id || '-'}
          </Descriptions.Item>
          <Descriptions.Item label="备注" span={2}>
            {patient.notes || '-'}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      {/* 基线检查 */}
      <Card
        title="基线检查"
        style={{ marginBottom: 16 }}
        extra={
          patient.has_baseline && baseline ? (
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => navigate(`/patients/${id}/baseline`)}
            >
              编辑基线
            </Button>
          ) : null
        }
      >
        {patient.has_baseline && baseline ? (
          <BaselineTable baseline={baseline} />
        ) : (
          <Empty
            description="暂无基线检查数据"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          >
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => navigate(`/patients/${id}/baseline`)}
            >
              录入基线检查
            </Button>
          </Empty>
        )}
      </Card>

      {/* 随访记录 */}
      <Card
        title="随访记录"
        extra={
          <Button
            type="primary"
            size="small"
            icon={<PlusOutlined />}
            onClick={() => navigate(`/patients/${id}/visits/new`)}
          >
            新建随访
          </Button>
        }
      >
        <VisitTimeline
          visits={visits}
          patientId={id}
          navigate={navigate}
        />
      </Card>
    </div>
  )
}

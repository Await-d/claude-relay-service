#!/usr/bin/env python3
"""
智能负载均衡算法原型实现

实现了基于成本、健康状态、性能和可靠性的多维度账户选择算法。
包含成本优先、加权轮询、健康检查和故障恢复等核心功能。
"""

import time
import random
import math
import threading
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple, Any
from datetime import datetime, timedelta
import statistics


@dataclass
class AccountMetrics:
    """账户性能指标"""
    account_id: str
    daily_cost: float = 0.0
    daily_requests: int = 0
    success_rate: float = 1.0
    avg_response_time: float = 0.0
    current_concurrent: int = 0
    requests_per_minute: float = 0.0
    uptime_hours: float = 24.0
    total_hours: float = 24.0
    recovery_time_avg: float = 0.0
    error_count: int = 0
    last_used: Optional[datetime] = None
    status: str = "active"
    priority: int = 50


@dataclass
class Account:
    """账户信息"""
    id: str
    name: str
    status: str = "active"
    priority: int = 50
    metrics: AccountMetrics = field(default_factory=lambda: AccountMetrics(""))
    
    def __post_init__(self):
        if not self.metrics.account_id:
            self.metrics.account_id = self.id


class MetricsCollector:
    """性能指标收集器"""
    
    def __init__(self, window_size: int = 100):
        self.window_size = window_size
        self.response_times = defaultdict(lambda: deque(maxlen=window_size))
        self.success_counts = defaultdict(int)
        self.total_counts = defaultdict(int)
        self.cost_history = defaultdict(lambda: deque(maxlen=window_size))
        self.lock = threading.RLock()
    
    def record_request(self, account_id: str, response_time: float, 
                      success: bool, cost: float = 0.0):
        """记录请求指标"""
        with self.lock:
            self.response_times[account_id].append(response_time)
            self.total_counts[account_id] += 1
            if success:
                self.success_counts[account_id] += 1
            if cost > 0:
                self.cost_history[account_id].append(cost)
    
    def get_metrics(self, account_id: str) -> Dict[str, float]:
        """获取账户指标"""
        with self.lock:
            response_times = list(self.response_times[account_id])
            costs = list(self.cost_history[account_id])
            
            avg_response_time = statistics.mean(response_times) if response_times else 0.0
            success_rate = (self.success_counts[account_id] / 
                          max(1, self.total_counts[account_id]))
            daily_cost = sum(costs) if costs else 0.0
            daily_requests = len(response_times)
            requests_per_minute = daily_requests / max(1, len(response_times) * 0.01)
            
            return {
                'avg_response_time': avg_response_time,
                'success_rate': success_rate,
                'daily_cost': daily_cost,
                'daily_requests': daily_requests,
                'requests_per_minute': requests_per_minute
            }


class AccountScorer:
    """账户评分计算器"""
    
    def __init__(self):
        # 权重配置
        self.weights = {
            'cost': 0.4,
            'health': 0.3,
            'performance': 0.2,
            'reliability': 0.1
        }
        
        # 缓存最值用于归一化
        self._min_max_cache = {}
        self._cache_ttl = 60  # 1分钟缓存
        self._last_cache_update = 0
    
    def normalize(self, value: float, min_val: float, max_val: float) -> float:
        """归一化函数，将值映射到0-1范围"""
        if max_val == min_val:
            return 0.5  # 如果所有值相同，返回中性值
        return max(0.0, min(1.0, (value - min_val) / (max_val - min_val)))
    
    def calculate_cost_score(self, account: Account, all_accounts: List[Account]) -> float:
        """计算成本效益得分 (0-1, 越高越好)"""
        if account.metrics.daily_requests == 0:
            return 0.5  # 无历史数据时的中性评分
        
        cost_per_request = account.metrics.daily_cost / account.metrics.daily_requests
        
        # 获取所有账户的成本范围用于归一化
        all_costs = []
        for acc in all_accounts:
            if acc.metrics.daily_requests > 0:
                all_costs.append(acc.metrics.daily_cost / acc.metrics.daily_requests)
        
        if not all_costs or len(all_costs) < 2:
            return 0.5
        
        min_cost = min(all_costs)
        max_cost = max(all_costs)
        
        # 成本越低得分越高，所以用1减去归一化值
        return 1.0 - self.normalize(cost_per_request, min_cost, max_cost)
    
    def calculate_health_score(self, account: Account, all_accounts: List[Account]) -> float:
        """计算健康状态得分 (0-1, 越高越好)"""
        w1, w2, w3 = 0.4, 0.4, 0.2  # 响应时间、成功率、可用性权重
        
        # 响应时间得分 (越低越好)
        all_response_times = [acc.metrics.avg_response_time for acc in all_accounts 
                             if acc.metrics.avg_response_time > 0]
        if all_response_times:
            min_time = min(all_response_times)
            max_time = max(all_response_times)
            response_score = 1.0 - self.normalize(account.metrics.avg_response_time, 
                                                min_time, max_time)
        else:
            response_score = 0.5
        
        # 成功率得分
        success_rate = account.metrics.success_rate
        
        # 可用性得分
        availability = 1.0 if account.status == 'active' else 0.0
        
        return w1 * response_score + w2 * success_rate + w3 * availability
    
    def calculate_performance_score(self, account: Account, all_accounts: List[Account]) -> float:
        """计算性能表现得分 (0-1, 越高越好)"""
        w1, w2 = 0.6, 0.4  # 吞吐量、负载均衡权重
        
        # 吞吐量得分
        all_throughputs = [acc.metrics.requests_per_minute for acc in all_accounts]
        if all_throughputs and max(all_throughputs) > min(all_throughputs):
            throughput_score = self.normalize(
                account.metrics.requests_per_minute,
                min(all_throughputs),
                max(all_throughputs)
            )
        else:
            throughput_score = 0.5
        
        # 负载均衡得分 (当前并发请求越少越好)
        all_concurrent = [acc.metrics.current_concurrent for acc in all_accounts]
        if all_concurrent and max(all_concurrent) > min(all_concurrent):
            load_balance_score = 1.0 - self.normalize(
                account.metrics.current_concurrent,
                min(all_concurrent),
                max(all_concurrent)
            )
        else:
            load_balance_score = 0.5
        
        return w1 * throughput_score + w2 * load_balance_score
    
    def calculate_reliability_score(self, account: Account, all_accounts: List[Account]) -> float:
        """计算可靠性得分 (0-1, 越高越好)"""
        w1, w2 = 0.6, 0.4  # 在线时间、错误恢复权重
        
        # 在线时间得分
        uptime_score = account.metrics.uptime_hours / max(1, account.metrics.total_hours)
        
        # 错误恢复得分 (恢复时间越短越好)
        all_recovery_times = [acc.metrics.recovery_time_avg for acc in all_accounts 
                             if acc.metrics.recovery_time_avg > 0]
        if all_recovery_times:
            min_recovery = min(all_recovery_times)
            max_recovery = max(all_recovery_times)
            error_recovery_score = 1.0 - self.normalize(
                account.metrics.recovery_time_avg,
                min_recovery,
                max_recovery
            )
        else:
            error_recovery_score = 0.5
        
        return w1 * uptime_score + w2 * error_recovery_score
    
    def calculate_account_score(self, account: Account, all_accounts: List[Account]) -> float:
        """计算账户综合得分"""
        cost_score = self.calculate_cost_score(account, all_accounts)
        health_score = self.calculate_health_score(account, all_accounts)
        performance_score = self.calculate_performance_score(account, all_accounts)
        reliability_score = self.calculate_reliability_score(account, all_accounts)
        
        final_score = (
            self.weights['cost'] * cost_score +
            self.weights['health'] * health_score +
            self.weights['performance'] * performance_score +
            self.weights['reliability'] * reliability_score
        )
        
        return final_score


class CostOptimizer:
    """成本优化选择器"""
    
    def __init__(self, scorer: AccountScorer):
        self.scorer = scorer
    
    def select_account(self, accounts: List[Account]) -> Optional[Account]:
        """基于成本优先选择账户"""
        healthy_accounts = [acc for acc in accounts if acc.status == 'active']
        
        if not healthy_accounts:
            return None
        
        if len(healthy_accounts) == 1:
            return healthy_accounts[0]
        
        # 计算成本效益排序
        scored_accounts = []
        for account in healthy_accounts:
            cost_score = self.scorer.calculate_cost_score(account, healthy_accounts)
            health_score = self.scorer.calculate_health_score(account, healthy_accounts)
            
            # 成本优先，健康状态作为次要因素
            final_score = 0.7 * cost_score + 0.3 * health_score
            scored_accounts.append((account, final_score))
        
        # 排序并选择最佳账户
        scored_accounts.sort(key=lambda x: x[1], reverse=True)
        return scored_accounts[0][0]


class WeightedRoundRobin:
    """加权轮询选择器"""
    
    def __init__(self, scorer: AccountScorer):
        self.scorer = scorer
        self.current_weights = {}
        self.total_weights = {}
        self.lock = threading.RLock()
    
    def select_account(self, accounts: List[Account]) -> Optional[Account]:
        """基于权重的轮询选择"""
        if not accounts:
            return None
        
        healthy_accounts = [acc for acc in accounts if acc.status == 'active']
        if not healthy_accounts:
            return None
        
        with self.lock:
            # 计算动态权重
            for account in healthy_accounts:
                score = self.scorer.calculate_account_score(account, healthy_accounts)
                self.total_weights[account.id] = max(1, int(score * 100))
                
                if account.id not in self.current_weights:
                    self.current_weights[account.id] = 0
            
            # 加权轮询选择
            max_current_weight = -1
            selected_account = None
            
            for account in healthy_accounts:
                self.current_weights[account.id] += self.total_weights[account.id]
                
                if self.current_weights[account.id] > max_current_weight:
                    max_current_weight = self.current_weights[account.id]
                    selected_account = account
            
            if selected_account:
                total_weight_sum = sum(self.total_weights[acc.id] for acc in healthy_accounts)
                self.current_weights[selected_account.id] -= total_weight_sum
            
            return selected_account


class HealthMonitor:
    """健康状态监控器"""
    
    def __init__(self, check_interval: int = 30):
        self.check_interval = check_interval
        self.health_cache = {}
        self.lock = threading.RLock()
    
    def check_account_health(self, account: Account) -> bool:
        """检查账户健康状态"""
        now = time.time()
        cache_key = account.id
        
        with self.lock:
            # 检查缓存是否有效
            if (cache_key in self.health_cache and 
                now - self.health_cache[cache_key]['timestamp'] < self.check_interval):
                return self.health_cache[cache_key]['healthy']
            
            # 执行健康检查
            health_metrics = self._measure_health_metrics(account)
            
            # 综合评估健康状态
            is_healthy = (
                health_metrics['response_time'] < 5000 and    # 5秒超时
                health_metrics['success_rate'] > 0.95 and     # 95%成功率
                health_metrics['error_rate'] < 0.05 and       # 5%错误率
                not health_metrics['rate_limit_status'] and   # 未被限流
                account.status == 'active'                    # 账户激活状态
            )
            
            # 更新缓存
            self.health_cache[cache_key] = {
                'healthy': is_healthy,
                'metrics': health_metrics,
                'timestamp': now
            }
            
            return is_healthy
    
    def _measure_health_metrics(self, account: Account) -> Dict[str, Any]:
        """测量健康指标 (模拟实现)"""
        return {
            'response_time': account.metrics.avg_response_time,
            'success_rate': account.metrics.success_rate,
            'error_rate': 1.0 - account.metrics.success_rate,
            'rate_limit_status': account.metrics.error_count > 10
        }


class FailureRecovery:
    """故障恢复管理器"""
    
    def __init__(self):
        self.failure_counts = defaultdict(int)
        self.recovery_attempts = defaultdict(int)
        self.circuit_breaker = {}
        self.lock = threading.RLock()
    
    def handle_request_failure(self, account_id: str, error_type: str):
        """处理请求失败"""
        with self.lock:
            self.failure_counts[account_id] += 1
            
            # 根据错误类型决定处理策略
            if error_type in ['rate_limit', 'quota_exceeded']:
                self._mark_temporary_failure(account_id, retry_delay=300)  # 5分钟
            elif error_type in ['auth_error', 'invalid_token']:
                self._trigger_token_refresh(account_id)
            else:
                self._activate_circuit_breaker(account_id)
    
    def _mark_temporary_failure(self, account_id: str, retry_delay: int = 300):
        """标记临时性失败"""
        self.circuit_breaker[account_id] = {
            'status': 'open',
            'retry_time': time.time() + retry_delay,
            'type': 'temporary'
        }
    
    def _trigger_token_refresh(self, account_id: str):
        """触发token刷新"""
        # 实际实现中应该调用token刷新服务
        print(f"Triggering token refresh for account {account_id}")
        self._mark_temporary_failure(account_id, retry_delay=60)  # 1分钟后重试
    
    def _activate_circuit_breaker(self, account_id: str):
        """激活熔断保护"""
        failure_count = self.failure_counts[account_id]
        
        if failure_count >= 5:  # 连续5次失败
            # 指数退避重试
            backoff_time = min(300 * (2 ** (failure_count - 5)), 3600)  # 最大1小时
            self.circuit_breaker[account_id] = {
                'status': 'open',
                'retry_time': time.time() + backoff_time,
                'type': 'circuit_breaker'
            }
    
    def can_use_account(self, account_id: str) -> bool:
        """检查账户是否可用"""
        with self.lock:
            if account_id not in self.circuit_breaker:
                return True
            
            cb_state = self.circuit_breaker[account_id]
            if cb_state['status'] == 'open':
                if time.time() >= cb_state['retry_time']:
                    # 尝试恢复
                    self.circuit_breaker[account_id]['status'] = 'half_open'
                    return True
                return False
            
            return True  # closed 或 half_open 状态
    
    def mark_success(self, account_id: str):
        """标记成功，重置失败状态"""
        with self.lock:
            # 重置失败计数
            if account_id in self.failure_counts:
                self.failure_counts[account_id] = 0
            
            # 关闭熔断器
            if account_id in self.circuit_breaker:
                del self.circuit_breaker[account_id]


class IntelligentScheduler:
    """智能调度器 - 综合所有算法的主控制器"""
    
    def __init__(self):
        self.metrics_collector = MetricsCollector()
        self.scorer = AccountScorer()
        self.cost_optimizer = CostOptimizer(self.scorer)
        self.weighted_rr = WeightedRoundRobin(self.scorer)
        self.health_monitor = HealthMonitor()
        self.failure_recovery = FailureRecovery()
        
        # 算法权重配置
        self.algorithm_weights = {
            'cost_priority': 0.4,      # 成本优先权重
            'performance': 0.3,        # 性能权重
            'load_balance': 0.2,       # 负载均衡权重
            'reliability': 0.1         # 可靠性权重
        }
        
        # 性能统计
        self.selection_stats = {
            'total_selections': 0,
            'avg_selection_time': 0.0,
            'cache_hits': 0,
            'algorithm_usage': defaultdict(int)
        }
        
        self.lock = threading.RLock()
    
    def select_account(self, accounts: List[Account], context: Optional[Dict] = None) -> Optional[Account]:
        """智能选择账户"""
        start_time = time.time()
        
        try:
            with self.lock:
                # 更新统计
                self.selection_stats['total_selections'] += 1
                
                # 1. 预过滤：移除不健康和熔断的账户
                available_accounts = self._filter_available_accounts(accounts)
                
                if not available_accounts:
                    raise Exception("No available accounts")
                
                if len(available_accounts) == 1:
                    return available_accounts[0]
                
                # 2. 根据上下文选择算法策略
                algorithm = self._select_algorithm(context)
                self.selection_stats['algorithm_usage'][algorithm] += 1
                
                # 3. 应用选择算法
                selected_account = self._apply_selection_algorithm(
                    algorithm, available_accounts, context
                )
                
                # 4. 记录选择结果
                selection_time = time.time() - start_time
                self._record_selection_metrics(selected_account, selection_time)
                
                return selected_account
                
        except Exception as e:
            # 降级处理：使用简单随机选择
            print(f"Selection failed, using fallback: {e}")
            return random.choice(accounts) if accounts else None
    
    def _filter_available_accounts(self, accounts: List[Account]) -> List[Account]:
        """过滤可用账户"""
        available = []
        for account in accounts:
            # 更新账户指标
            metrics = self.metrics_collector.get_metrics(account.id)
            account.metrics.avg_response_time = metrics['avg_response_time']
            account.metrics.success_rate = metrics['success_rate']
            account.metrics.daily_cost = metrics['daily_cost']
            account.metrics.daily_requests = metrics['daily_requests']
            account.metrics.requests_per_minute = metrics['requests_per_minute']
            
            # 检查健康状态和熔断状态
            if (self.health_monitor.check_account_health(account) and
                self.failure_recovery.can_use_account(account.id)):
                available.append(account)
        
        return available
    
    def _select_algorithm(self, context: Optional[Dict] = None) -> str:
        """根据上下文选择算法"""
        if not context:
            return 'intelligent'  # 默认使用智能算法
        
        # 根据请求特征选择算法
        if context.get('cost_sensitive', False):
            return 'cost_first'
        elif context.get('high_concurrency', False):
            return 'weighted_round_robin'
        else:
            return 'intelligent'
    
    def _apply_selection_algorithm(self, algorithm: str, accounts: List[Account], 
                                 context: Optional[Dict] = None) -> Optional[Account]:
        """应用选择算法"""
        if algorithm == 'cost_first':
            return self.cost_optimizer.select_account(accounts)
        elif algorithm == 'weighted_round_robin':
            return self.weighted_rr.select_account(accounts)
        elif algorithm == 'intelligent':
            return self._intelligent_selection(accounts)
        else:
            return random.choice(accounts)
    
    def _intelligent_selection(self, accounts: List[Account]) -> Optional[Account]:
        """智能选择算法 - 综合多个维度评分"""
        if not accounts:
            return None
        
        # 计算每个账户的综合评分
        scores = {}
        for account in accounts:
            # 成本评分
            cost_score = self.scorer.calculate_cost_score(account, accounts)
            
            # 性能评分  
            performance_score = self.scorer.calculate_performance_score(account, accounts)
            
            # 健康评分
            health_score = self.scorer.calculate_health_score(account, accounts)
            
            # 可靠性评分
            reliability_score = self.scorer.calculate_reliability_score(account, accounts)
            
            # 综合评分
            final_score = (
                self.algorithm_weights['cost_priority'] * cost_score +
                self.algorithm_weights['performance'] * performance_score +
                self.algorithm_weights['load_balance'] * health_score +
                self.algorithm_weights['reliability'] * reliability_score
            )
            
            scores[account.id] = final_score
        
        # 选择最佳账户（在前20%中随机选择避免热点）
        sorted_accounts = sorted(accounts, key=lambda x: scores[x.id], reverse=True)
        top_percent = max(1, len(sorted_accounts) // 5)
        
        return random.choice(sorted_accounts[:top_percent])
    
    def _record_selection_metrics(self, account: Optional[Account], selection_time: float):
        """记录选择指标"""
        # 更新平均选择时间
        total_time = (self.selection_stats['avg_selection_time'] * 
                     (self.selection_stats['total_selections'] - 1) + selection_time)
        self.selection_stats['avg_selection_time'] = (
            total_time / self.selection_stats['total_selections']
        )
        
        if account:
            account.metrics.last_used = datetime.now()
    
    def record_request_result(self, account_id: str, success: bool, 
                            response_time: float, cost: float = 0.0, 
                            error_type: Optional[str] = None):
        """记录请求结果"""
        # 记录指标
        self.metrics_collector.record_request(account_id, response_time, success, cost)
        
        # 处理成功/失败
        if success:
            self.failure_recovery.mark_success(account_id)
        else:
            if error_type:
                self.failure_recovery.handle_request_failure(account_id, error_type)
    
    def get_performance_stats(self) -> Dict[str, Any]:
        """获取性能统计"""
        return {
            **self.selection_stats,
            'health_cache_size': len(self.health_monitor.health_cache),
            'circuit_breakers': len(self.failure_recovery.circuit_breaker),
            'failure_counts': dict(self.failure_recovery.failure_counts)
        }


# 异常类定义
class NoAvailableAccountError(Exception):
    """没有可用账户异常"""
    pass


if __name__ == "__main__":
    # 简单的使用示例
    print("智能负载均衡算法原型")
    print("=" * 50)
    
    # 创建调度器
    scheduler = IntelligentScheduler()
    
    # 创建测试账户
    accounts = [
        Account("acc1", "Account 1", metrics=AccountMetrics(
            "acc1", daily_cost=10.0, daily_requests=100, success_rate=0.95, 
            avg_response_time=200.0, priority=10
        )),
        Account("acc2", "Account 2", metrics=AccountMetrics(
            "acc2", daily_cost=15.0, daily_requests=150, success_rate=0.98, 
            avg_response_time=150.0, priority=20  
        )),
        Account("acc3", "Account 3", metrics=AccountMetrics(
            "acc3", daily_cost=8.0, daily_requests=80, success_rate=0.92, 
            avg_response_time=250.0, priority=30
        ))
    ]
    
    # 模拟一些历史数据
    for i in range(50):
        for acc in accounts:
            success = random.random() > 0.05  # 95%成功率
            response_time = random.gauss(acc.metrics.avg_response_time, 50)
            cost = random.uniform(0.05, 0.15)
            scheduler.record_request_result(acc.id, success, response_time, cost)
    
    # 进行多次选择测试
    print("执行选择测试...")
    selection_results = defaultdict(int)
    
    for i in range(100):
        selected = scheduler.select_account(accounts)
        if selected:
            selection_results[selected.name] += 1
    
    print("\n选择结果分布:")
    for name, count in selection_results.items():
        print(f"{name}: {count}次 ({count/100*100:.1f}%)")
    
    print(f"\n性能统计:")
    stats = scheduler.get_performance_stats()
    for key, value in stats.items():
        print(f"{key}: {value}")
    
    print("\n算法原型实现完成!")
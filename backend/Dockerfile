FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd --create-home appuser && mkdir /data && chown appuser:appuser /data
COPY main.py shared_departure_alerts.py mobility_journeys.py transport_discovery.py local_business.py http_boundary.py operations.py integrations.py rewards.py lifecycle.py refunds.py evidence.py shops.py procurement.py shop_payouts.py discovery.py search_index.py rentals.py workspace.py marketplace.py parts_payments.py worker_records.py hiring.py promotions.py home_plans.py home_briefs.py partner_program.py hire_discovery.py tenders.py contract_work.py coupons.py opportunities.py retail_checkout.py worker_network.py ./
COPY b2b.py professional_offers.py shop_prime.py repaidians.py repaidians_milestones.py repaidians_live.py repaidians_network.py repaidians_media.py repaidians_billing.py repaidians_opportunities.py ./
COPY cleanup.py captain_rewards.py captain_policy.py custom_contracts.py contract_records.py account_profile.py transactional_mail.py repaidians_work.py work_runtime.py work_service.py work_worker.py work_push.py ./
COPY repaidians_tools.py community_service.py work_dispatch.py ./
COPY hire_ranking.py hire_ranking_client.py hire_ranking_service.py ./
COPY scrap_experience.py ./
COPY market_access.py market_messaging.py market_delivery.py ./
COPY fonts/ ./fonts/
RUN chmod 755 /app/fonts && chmod 644 /app/fonts/*
RUN chmod 644 /app/*.py /app/requirements.txt
USER appuser
ENV REPAIDO_DB=/data/repaido.db
EXPOSE 8000
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --no-proxy-headers"]
